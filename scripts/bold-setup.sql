-- ============================================================================
-- Bold (pagos) — tablas y columnas necesarias para ACTIVAR Premium vía webhook.
-- ----------------------------------------------------------------------------
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run.
--
-- Por qué importa: el webhook (/api/bold/webhook) marca la orden pagada y sube
-- el perfil a Premium escribiendo profiles.plan / route_quota / premium_since.
-- Y getPlan() (la pantalla /premium/gracias) LEE premium_since. Si esa columna
-- o estas tablas no existen, el pago llega pero el usuario nunca se activa.
-- ============================================================================

-- 1) Órdenes de pago. /api/bold/generate-hash crea una fila 'pending' al iniciar
--    el checkout; el webhook de Bold la marca 'paid' cuando el pago se aprueba.
create table if not exists public.payment_orders (
  order_id   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  amount     numeric not null,
  currency   text not null default 'COP',
  purpose    text not null default 'premium',  -- 'premium' = sube el plan
  status     text not null default 'pending',  -- 'pending' | 'paid'
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);
create index if not exists idx_payment_orders_user   on public.payment_orders (user_id);
create index if not exists idx_payment_orders_status on public.payment_orders (status);

-- 2) Auditoría: TODO lo que Bold manda al webhook se guarda aquí (haya orden o
--    no). Sirve para que el admin VEA las confirmaciones llegando.
create table if not exists public.bold_transactions (
  id               uuid primary key default gen_random_uuid (),
  payment_id       text not null unique,
  transaction_type text not null,
  amount_total     numeric not null default 0,
  amount_currency  text default 'COP',
  order_reference  text,
  customer_data    jsonb,
  raw_data         jsonb not null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_bold_tx_created on public.bold_transactions (created_at desc);
create index if not exists idx_bold_tx_order   on public.bold_transactions (order_reference);

-- 3) Columnas de plan en profiles (por si faltan en tu base). El webhook escribe
--    estas; getPlan() y el panel de admin las leen. 'premium_since' es la que
--    suele faltar y, al faltar, hace que el pago "no active" al usuario.
alter table public.profiles add column if not exists plan          text        default 'free';
alter table public.profiles add column if not exists route_quota   integer     default 1;
alter table public.profiles add column if not exists premium_since timestamptz;
alter table public.profiles add column if not exists batch_enabled boolean     default false;

-- 4) RLS: estas dos tablas se tocan SOLO desde el servidor (service role, que
--    salta RLS). No publicamos políticas anónimas → nadie con la anon key puede
--    leer/escribir pagos. (profiles ya trae su propia RLS configurada aparte.)
alter table public.payment_orders   enable row level security;
alter table public.bold_transactions enable row level security;
