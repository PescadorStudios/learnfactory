-- ============================================================================
-- Modo Scroll — feed vertical estilo reels sobre las lecciones existentes.
-- ----------------------------------------------------------------------------
-- Idempotente. Supabase → SQL Editor → pega esto → Run (puedes correrlo 2 veces).
--
-- El "corto" de cada lección NO es un MP4: es un timeline declarativo (JSON) que
-- el "Director" (Gemini, offline, UNA vez por lección) produce a partir de la
-- narración, y que el reproductor vertical renderiza EN VIVO sincronizado al
-- audio TTS que ya existe (bucket lesson-audio + lessons.audio_duration).
--
-- Espeja el sistema de jobs durable de generación de rutas (route-jobs-setup.sql):
-- el worker (/api/scroll-jobs/worker) reclama el job con un lease y genera los
-- timelines en lotes; el cron de Vercel resucita jobs cuyo lease expiró.
-- ============================================================================

-- ── lessons: el corto de cada lección (timeline declarativo + estado) ────────
-- timeline_json: contrato del Director (ver src/lib/types.ts → LessonTimeline).
-- La duración del corto = audio_duration (no se duplica como duracion_ms).
alter table public.lessons add column if not exists timeline_json    jsonb;
alter table public.lessons add column if not exists poster_path      text;
alter table public.lessons add column if not exists timeline_status  text not null default 'pending'
  check (timeline_status in ('pending','generating','ready','error'));
alter table public.lessons add column if not exists timeline_attempts    int not null default 0;
alter table public.lessons add column if not exists timeline_generating_at timestamptz;
alter table public.lessons add column if not exists timeline_error    text;

create index if not exists lessons_timeline_status_idx
  on public.lessons (route_id, timeline_status);

-- ── routes: estado global de los videos del Modo Scroll ──────────────────────
-- sin_videos: el creador puede generar · generando: job en curso ·
-- listo: cortos disponibles en los feeds · error: falló, se puede reintentar.
-- El TAMAÑO ya existe como routes.size (corta/mediana/completa).
alter table public.routes add column if not exists videos_estado text not null default 'sin_videos'
  check (videos_estado in ('sin_videos','generando','listo','error'));

-- ── Tabla de jobs (uno por ruta a "videar"), espejo de route_jobs ────────────
create table if not exists public.scroll_jobs (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null unique references public.routes(id) on delete cascade,
  owner_id    uuid,
  owner_email text,
  status      text not null default 'queued'
              check (status in ('queued','running','done','error')),
  total       int  not null default 0,
  completed   int  not null default 0,
  attempts    int  not null default 0,
  -- Heartbeat: mientras now() < lease_until el job está "tomado".
  lease_until timestamptz,
  -- Guard de idempotencia del correo "videos listos" (se manda UNA sola vez).
  notified_at timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists scroll_jobs_status_idx on public.scroll_jobs(status);
create index if not exists scroll_jobs_lease_idx  on public.scroll_jobs(lease_until);

-- ── RLS: solo el service role escribe; el dueño puede consultar su job ────────
alter table public.scroll_jobs enable row level security;
drop policy if exists scroll_jobs_owner_read on public.scroll_jobs;
create policy scroll_jobs_owner_read on public.scroll_jobs
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- ── RPC: reclamar UN job de forma atómica (lease) ────────────────────────────
-- Toma un job 'queued' o uno 'running' con lease expirado, lo pone 'running' y le
-- fija un lease nuevo. FOR UPDATE SKIP LOCKED evita que dos workers tomen el mismo.
create or replace function public.claim_scroll_job(p_lease_seconds int)
returns setof public.scroll_jobs
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.scroll_jobs
  where status = 'queued'
     or (status = 'running' and (lease_until is null or lease_until < now()))
  order by updated_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.scroll_jobs
  set status      = 'running',
      lease_until = now() + make_interval(secs => p_lease_seconds),
      updated_at  = now()
  where id = v_id
  returning *;
end;
$$;

-- ── RPC: reclamar hasta N lecciones cuyo TIMELINE está pendiente ─────────────
-- Solo lecciones con AUDIO listo (audio_path no nulo): el corto se sincroniza al
-- audio existente. Marca timeline_status pending → generating, pone
-- timeline_generating_at = now() e incrementa timeline_attempts. Devuelve los
-- node_id reclamados. Columnas internas calificadas con alias (l.* / s.*) para
-- no chocar con la columna de retorno node_id (mismo bug que en route-jobs).
create or replace function public.claim_scroll_timelines(p_route_id uuid, p_limit int)
returns table(node_id text)
language plpgsql
as $$
begin
  return query
  update public.lessons l
  set timeline_status     = 'generating',
      timeline_generating_at = now(),
      timeline_error      = null,
      timeline_attempts   = l.timeline_attempts + 1
  where l.id in (
    select s.id from public.lessons s
    where s.route_id        = p_route_id
      and s.status          = 'ready'
      and s.audio_path is not null
      and s.timeline_status = 'pending'
    order by s.node_id asc
    for update skip locked
    limit p_limit
  )
  returning l.node_id;
end;
$$;

grant execute on function public.claim_scroll_job(int)             to service_role;
grant execute on function public.claim_scroll_timelines(uuid, int) to service_role;

-- ── corto_evento: engagement por corto (alimenta el feedRanker y el repaso) ──
-- Una fila por interacción/visionado. pct_visto es el máximo % visto del corto.
create table if not exists public.corto_evento (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references public.profiles(id) on delete cascade,
  route_id        uuid not null references public.routes(id) on delete cascade,
  leccion_node_id text not null,
  pct_visto       numeric not null default 0,
  liked           boolean not null default false,
  guardado        boolean not null default false,
  abrir_ruta      boolean not null default false,
  ts              timestamptz not null default now()
);

create index if not exists corto_evento_usuario_idx on public.corto_evento (usuario_id, ts desc);
create index if not exists corto_evento_corto_idx   on public.corto_evento (route_id, leccion_node_id);

-- RLS: solo desde el servidor (service role). Sin políticas anónimas.
alter table public.corto_evento enable row level security;

-- ── credito_transaccion: log de descuentos de crédito ───────────────────────
-- Hoy el "usado" se derivaba solo de routes.credits; los gastos que NO son crear
-- ruta (p.ej. generar videos del Modo Scroll) se registran aquí y también cuentan
-- contra profiles.route_quota. monto > 0 = créditos consumidos.
create table if not exists public.credito_transaccion (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  route_id   uuid references public.routes(id) on delete set null,
  monto      int  not null,
  motivo     text not null,
  created_at timestamptz not null default now()
);

create index if not exists credito_transaccion_usuario_idx on public.credito_transaccion (usuario_id, created_at desc);
-- Evita doble cobro al reintentar la generación de videos de una misma ruta.
create unique index if not exists credito_transaccion_video_unico
  on public.credito_transaccion (route_id, motivo)
  where motivo = 'generar_video_modo_scroll';

-- RLS: solo desde el servidor (service role). Sin políticas anónimas.
alter table public.credito_transaccion enable row level security;

-- ── Gamificación: tiempo visto en Modo Scroll (segundos, global por usuario) ──
-- Igual que profiles.podcast_seconds (gamification-setup.sql). El nivel se deriva
-- en el cliente (src/lib/listeningLevels.ts → SCROLL_LEVELS), no se guarda.
alter table public.profiles add column if not exists scroll_seconds int not null default 0;
