-- ============================================================================
-- Generación de rutas autónoma — tabla de jobs + RPCs de reclamo atómico.
-- ----------------------------------------------------------------------------
-- Idempotente. Supabase → SQL Editor → pega esto → Run.
--
-- Reemplaza el "lock en memoria" de la generación por un job DURABLE que
-- sobrevive reinicios y coordina varias instancias serverless. El worker
-- (/api/route-jobs/worker) reclama el job con un lease y genera las lecciones
-- en lotes; el cron de Vercel resucita jobs cuyo lease expiró.
-- ============================================================================

-- ── Tabla de jobs (uno por ruta a generar) ──────────────────────────────────
create table if not exists public.route_jobs (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null unique references public.routes(id) on delete cascade,
  owner_id    uuid,
  owner_email text,
  -- queued: esperando worker · running: con lease activo · done: todo ok ·
  -- error: terminó con lecciones en error tras agotar reintentos.
  status      text not null default 'queued'
              check (status in ('queued','running','done','error')),
  total       int  not null default 0,
  completed   int  not null default 0,
  attempts    int  not null default 0,
  -- Heartbeat: mientras now() < lease_until el job está "tomado". Si expira,
  -- otro worker (o el cron) lo puede reclamar (su proceso murió).
  lease_until timestamptz,
  -- Guard de idempotencia del correo "ruta lista" (se manda UNA sola vez).
  notified_at timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists route_jobs_status_idx on public.route_jobs(status);
create index if not exists route_jobs_lease_idx  on public.route_jobs(lease_until);

-- Tope de reintentos POR LECCIÓN: cada reclamo incrementa attempts; al pasar el
-- tope (lo aplica el worker) la lección deja de reintentarse y el job va a error.
alter table public.lessons add column if not exists attempts int not null default 0;

-- ── RLS: solo el service role escribe; el dueño puede consultar su job ───────
alter table public.route_jobs enable row level security;
drop policy if exists route_jobs_owner_read on public.route_jobs;
create policy route_jobs_owner_read on public.route_jobs
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- ── RPC: reclamar UN job de forma atómica (lease) ───────────────────────────
-- Toma un job 'queued' o uno 'running' cuyo lease expiró, lo pone 'running' y
-- le fija un lease nuevo. FOR UPDATE SKIP LOCKED garantiza que dos workers (o el
-- cron) nunca tomen el mismo job. Devuelve 0 o 1 filas.
create or replace function public.claim_route_job(p_lease_seconds int)
returns setof public.route_jobs
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.route_jobs
  where status = 'queued'
     or (status = 'running' and (lease_until is null or lease_until < now()))
  order by updated_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.route_jobs
  set status      = 'running',
      lease_until = now() + make_interval(secs => p_lease_seconds),
      updated_at  = now()
  where id = v_id
  returning *;
end;
$$;

-- ── RPC: reclamar hasta N lecciones pendientes de una ruta ──────────────────
-- Marca pending → generating (no debates), pone generating_at = now() e
-- incrementa attempts. SKIP LOCKED evita que dos workers tomen la misma
-- lección. Devuelve los node_id reclamados para que el worker los genere.
-- IMPORTANTE: TODAS las columnas internas van calificadas con alias de tabla
-- (s.* / l.*). Sin calificar, `order by node_id` choca con el nombre de la
-- columna de retorno y Postgres lanza "column reference node_id is ambiguous"
-- (lo que hacía que el worker no generara ninguna lección).
create or replace function public.claim_route_lessons(p_route_id uuid, p_limit int)
returns table(node_id text)
language plpgsql
as $$
begin
  return query
  update public.lessons l
  set status        = 'generating',
      generating_at = now(),
      error         = null,
      attempts      = l.attempts + 1
  where l.id in (
    select s.id from public.lessons s
    where s.route_id  = p_route_id
      and s.status    = 'pending'
      and s.node_type <> 'debate'
    order by s.node_id asc
    for update skip locked
    limit p_limit
  )
  returning l.node_id;
end;
$$;

-- service_role ejecuta las RPC (el worker usa la service key).
grant execute on function public.claim_route_job(int)              to service_role;
grant execute on function public.claim_route_lessons(uuid, int)    to service_role;
