-- ============================================================================
-- Campañas a usuarios registrados — re-enganche por correo (Resend).
-- ----------------------------------------------------------------------------
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run.
--
-- Por qué importa: el panel /admin → Campañas LEE y ESCRIBE estas tablas.
--   • user_campaigns: correos redactados y GUARDADOS CON UN NOMBRE (reutilizables).
--   • user_campaign_sends: bitácora de cada envío (para el tope diario, el
--     historial y no enviar dos veces lo mismo a la misma persona).
--
-- El envío usa la MISMA dirección (EMAIL_FROM), la MISMA firma del panel y el
-- MISMO throttle (pausa entre correos) que el CRM de creadores, y además guarda
-- una fila 'outbound' en public.emails para el historial unificado de Correos.
-- ============================================================================

-- ── Correos guardados por nombre ─────────────────────────────────────────────
create table if not exists public.user_campaigns (
  id         uuid primary key default gen_random_uuid (),
  name       text not null,                 -- nombre con el que se guarda ("Retomar teología v1")
  subject    text not null default '',      -- asunto (acepta merge fields)
  body       text not null default '',      -- cuerpo en texto plano (acepta merge fields)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_campaigns_updated on public.user_campaigns (updated_at desc);

-- ── Bitácora de envíos a usuarios ────────────────────────────────────────────
create table if not exists public.user_campaign_sends (
  id          uuid primary key default gen_random_uuid (),
  campaign_id uuid references public.user_campaigns (id) on delete set null,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  route_id    uuid references public.routes (id) on delete set null,  -- curso referenciado
  subject     text,
  status      text not null default 'sent' check (status in ('sent', 'failed')),
  sent_at     timestamptz not null default now()
);

create index if not exists idx_ucs_sent_at on public.user_campaign_sends (sent_at desc);
create index if not exists idx_ucs_user    on public.user_campaign_sends (user_id, sent_at desc);
-- Para contar el tope diario de envíos exitosos de hoy rápido.
create index if not exists idx_ucs_sent_ok on public.user_campaign_sends (sent_at)
  where status = 'sent';

-- ── Ruta objetivo opcional de la campaña ─────────────────────────────────────
-- Cuando target_route_id != null, los merge fields ({{curso}}, {{progreso}},
-- {{enlace}}) se resuelven contra ESA ruta para sus estudiantes (no el curso a
-- medias auto-detectado). El contenido de valor lo hornea la IA en el cuerpo.
-- Null = comportamiento original (curso a medias del propio usuario).
alter table public.user_campaigns
  add column if not exists target_route_id uuid references public.routes (id) on delete set null;

create index if not exists idx_user_campaigns_target on public.user_campaigns (target_route_id);

-- Acelera el cálculo de la audiencia por ruta (quién estudia la ruta X, su
-- avance y si pasó nodos). Complementan los índices ya existentes de attempts.
create index if not exists idx_attempts_route_passed on public.attempts (route_id, passed);
create index if not exists idx_route_starts_route    on public.route_starts (route_id);

-- RLS: estas tablas se tocan SOLO desde el servidor (service role, salta RLS).
-- No publicamos políticas anónimas → nadie con la anon key puede leer/escribir.
alter table public.user_campaigns      enable row level security;
alter table public.user_campaign_sends enable row level security;
