-- ============================================================================
-- CRM de outreach a creadores (Learn Factory) — tablas para importar, revisar,
-- enviar en lote y registrar respuestas.
-- ----------------------------------------------------------------------------
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run.
--
-- Por qué importa: el panel /admin → Creadores LEE y ESCRIBE estas tablas.
--   • Importación: pegas el JSON del skill de investigación → crea un batch y
--     hace upsert de creadores por su `id` (no duplica al reimportar).
--   • Envío: cada envío usa Resend (la misma dirección EMAIL_FROM y firma del
--     panel) y registra un creator_touch (email/out).
--   • Respuestas: el webhook /api/emails/inbound empareja el correo entrante con
--     un creador por la dirección del remitente y marca 'respondio'.
-- ============================================================================

-- ── Lotes de investigación ───────────────────────────────────────────────────
create table if not exists public.outreach_batches (
  id              uuid primary key default gen_random_uuid (),
  niche           text,
  language        text,
  requested_count int,
  delivered_count int,
  research_notes  text,
  created_at      timestamptz not null default now()
);

-- ── Creadores ────────────────────────────────────────────────────────────────
-- El `id` es el del JSON (string), por eso es la PK: el upsert por id evita
-- duplicar si reimportas el mismo lote.
create table if not exists public.creators (
  id                   text primary key,
  batch_id             uuid references public.outreach_batches (id) on delete set null,
  name                 text not null,
  niche                text,
  language             text,

  youtube_url          text,
  youtube_handle       text,
  subscribers_estimate text,
  instagram_handle     text,
  instagram_url        text,
  x_handle             text,
  x_url                text,

  email                text,                                  -- nullable
  email_status         text not null default 'not_found'
                         check (email_status in ('found', 'not_found', 'guessed')),

  best_series          text,
  personalization_hook text,

  -- Plantilla editable por fila + merge fields.
  email_subject        text,
  email_body           text,
  personalized_note    text not null default '',
  route_link           text not null default '',
  channel_priority     jsonb,

  status               text not null default 'investigado'
                         check (status in (
                           'investigado', 'construyendo_ruta', 'listo', 'enviado',
                           'seguimiento_enviado', 'respondio', 'interesado', 'ganado',
                           'rechazado', 'reboto', 'solo_manual'
                         )),

  sent_at              timestamptz,
  follow_up_sent_at    timestamptz,
  reply_received_at    timestamptz,
  reply_snippet        text,
  bounced_at           timestamptz,

  source_notes         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_creators_status on public.creators (status);
create index if not exists idx_creators_batch  on public.creators (batch_id);
create index if not exists idx_creators_email  on public.creators (lower(email));

-- ── Bitácora de actividad (manual y automática) ──────────────────────────────
create table if not exists public.creator_touches (
  id          uuid primary key default gen_random_uuid (),
  creator_id  text not null references public.creators (id) on delete cascade,
  channel     text not null check (channel in ('email', 'instagram', 'x', 'youtube')),
  direction   text not null check (direction in ('out', 'in')),
  note        text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_touches_creator on public.creator_touches (creator_id, occurred_at desc);
-- Para contar el tope diario de envíos (email/out de hoy) rápido.
create index if not exists idx_touches_email_out on public.creator_touches (occurred_at)
  where channel = 'email' and direction = 'out';

-- RLS: estas tablas se tocan SOLO desde el servidor (service role, salta RLS).
-- No publicamos políticas anónimas → nadie con la anon key puede leer/escribir.
alter table public.outreach_batches enable row level security;
alter table public.creators        enable row level security;
alter table public.creator_touches enable row level security;
