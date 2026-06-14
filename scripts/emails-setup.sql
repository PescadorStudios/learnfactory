-- ============================================================================
-- Correos (Resend + Cloudflare) — tabla para ENVIAR y RECIBIR desde el admin.
-- ----------------------------------------------------------------------------
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run.
--
-- Por qué importa: el panel /admin → Correos LEE y ESCRIBE esta tabla.
--   • Salientes: adminSendEmail() llama a Resend y guarda aquí una fila 'outbound'.
--   • Entrantes: el webhook /api/emails/inbound (que llama tu Email Worker de
--     Cloudflare) guarda aquí una fila 'inbound' por cada correo recibido.
-- ============================================================================

create table if not exists public.emails (
  id          uuid primary key default gen_random_uuid (),
  direction   text not null check (direction in ('inbound', 'outbound')),
  from_addr   text not null,                       -- quién envía
  to_addr     text not null,                       -- a quién va
  subject     text,
  body_text   text,                                -- cuerpo en texto plano
  body_html   text,                                -- cuerpo en HTML (si lo hay)
  status      text not null default 'received',    -- inbound: 'received' | outbound: 'sent' | 'failed'
  provider_id text,                                -- id de Resend (salida) o Message-Id (entrada)
  in_reply_to text,                                -- provider_id/Message-Id al que responde (hilos)
  is_read     boolean not null default false,      -- para marcar entrantes leídos/no leídos
  raw         jsonb,                               -- payload crudo (auditoría / depuracion)
  created_at  timestamptz not null default now()
);

create index if not exists idx_emails_created   on public.emails (created_at desc);
create index if not exists idx_emails_direction on public.emails (direction);
create index if not exists idx_emails_unread    on public.emails (is_read) where direction = 'inbound';

-- RLS: esta tabla se toca SOLO desde el servidor (service role, que salta RLS).
-- No publicamos políticas anónimas → nadie con la anon key puede leer/escribir.
alter table public.emails enable row level security;
