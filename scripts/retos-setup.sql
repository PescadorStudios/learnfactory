-- ============================================================================
-- Academia de Retos Verificados — esquema completo.
-- ----------------------------------------------------------------------------
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run
--            (o: node scripts/apply-sql.mjs scripts/retos-setup.sql)
--
-- Qué monta: un creador crea un reto ligado a una ruta PRIVADA. Su audiencia
-- entra pagando (Bold, split 80/20 a la wallet del creador) o canjeando un
-- código de cupo gratis. Los primeros en completar el 100% de la ruta CON
-- verificación de atención ganan los premios ordenados del reto. El timestamp
-- de finalización es INMUTABLE (trigger) para proteger la transparencia.
-- ============================================================================

-- 1) Retos: uno por ruta (la ruta se crea junto al reto con visibility='private').
create table if not exists public.retos (
  id                     uuid primary key default gen_random_uuid(),
  creador_id             uuid not null references auth.users(id) on delete cascade,
  ruta_id                uuid not null references public.routes(id) on delete cascade unique,
  titulo                 text not null,
  descripcion            text,
  imagen_path            text,                        -- bucket route-covers, prefijo reto-{id}/
  precio_entrada         integer not null default 0,  -- Bold exige enteros; 0 = reto gratuito
  moneda                 text not null default 'COP', -- 'COP' | 'USD'
  fecha_inicio           timestamptz,
  fecha_fin              timestamptz,
  estado                 text not null default 'borrador', -- borrador|publicado|en_curso|finalizado
  reglas                 text,
  cupos_gratis_totales   integer not null default 10 check (cupos_gratis_totales between 0 and 10),
  cupos_gratis_usados    integer not null default 0,
  winners_notificados_at timestamptz,                 -- candado: correo de anuncio una sola vez
  created_at             timestamptz not null default now()
);
create index if not exists idx_retos_creador on public.retos (creador_id);
create index if not exists idx_retos_estado  on public.retos (estado);
create index if not exists idx_retos_ruta    on public.retos (ruta_id);

-- 2) Premios ordenados: posición 1 = premio mayor. Nº de premios = nº de ganadores.
create table if not exists public.reto_premios (
  id          uuid primary key default gen_random_uuid(),
  reto_id     uuid not null references public.retos(id) on delete cascade,
  posicion    integer not null check (posicion >= 1),
  titulo      text not null,
  descripcion text,
  tipo        text not null default 'otro', -- mentoria|colaboracion_canal|acceso_exclusivo|producto|otro
  unique (reto_id, posicion)
);
create index if not exists idx_reto_premios_reto on public.reto_premios (reto_id);

-- 3) Cupos gratis: códigos canjeables (máx. 10 por reto). El creador los genera,
--    los copia y los regala/sortea; un código se canjea UNA sola vez.
create table if not exists public.reto_cupos (
  id           uuid primary key default gen_random_uuid(),
  reto_id      uuid not null references public.retos(id) on delete cascade,
  codigo       text not null unique,               -- p. ej. RETO-XR4K9
  estado       text not null default 'disponible', -- disponible|canjeado
  canjeado_por uuid references auth.users(id) on delete set null,
  fecha_canje  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_reto_cupos_reto on public.reto_cupos (reto_id);

-- 4) Participantes: inscripción (pago o cupo) + finalización verificada.
--    finalizacion_verificada_at la fija SOLO el servidor, una única vez.
create table if not exists public.reto_participantes (
  id                         uuid primary key default gen_random_uuid(),
  reto_id                    uuid not null references public.retos(id) on delete cascade,
  user_id                    uuid not null references auth.users(id) on delete cascade,
  via                        text not null default 'pago', -- pago|cupo
  order_id                   text,                         -- payment_orders.order_id (via pago)
  consent_contacto           boolean not null default false, -- autorizó compartir contacto al creador
  alias                      text,                         -- nombre visible en el leaderboard público
  anonimo                    boolean not null default false,
  inscrito_at                timestamptz not null default now(),
  finalizacion_verificada_at timestamptz,                  -- inmutable (trigger de abajo)
  atencion_score             numeric,                      -- % global de atención (desempate)
  premio_posicion            integer,                      -- posición ganada (null = sin premio)
  unique (reto_id, user_id)
);
create index if not exists idx_reto_part_reto on public.reto_participantes (reto_id);
create index if not exists idx_reto_part_user on public.reto_participantes (user_id);
-- Un premio (posición) solo puede asignarse a UN participante por reto.
create unique index if not exists uq_reto_premio_pos
  on public.reto_participantes (reto_id, premio_posicion)
  where premio_posicion is not null;

-- Inmutabilidad auditable: una vez fijado, el timestamp de finalización no se
-- puede cambiar desde ningún panel ni query (protege la transparencia del reto).
create or replace function public.reto_lock_finalizacion() returns trigger as $$
begin
  if old.finalizacion_verificada_at is not null
     and new.finalizacion_verificada_at is distinct from old.finalizacion_verificada_at then
    raise exception 'finalizacion_verificada_at es inmutable';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_reto_lock_finalizacion on public.reto_participantes;
create trigger trg_reto_lock_finalizacion
  before update on public.reto_participantes
  for each row execute function public.reto_lock_finalizacion();

-- 5) Wallet del creador: cada pago aprobado acredita 80% al creador y 20% a la
--    plataforma. SIN payout automático: el admin marca 'liquidado' cuando paga
--    por fuera. order_id UNIQUE = idempotencia ante reintentos del webhook.
create table if not exists public.wallet_movimientos (
  id               uuid primary key default gen_random_uuid(),
  creador_id       uuid not null references auth.users(id) on delete cascade,
  reto_id          uuid not null references public.retos(id) on delete cascade,
  participante_id  uuid references public.reto_participantes(id) on delete set null,
  order_id         text unique,
  monto_bruto      numeric not null,
  monto_creador    numeric not null,  -- 80%
  monto_plataforma numeric not null,  -- 20%
  moneda           text not null default 'COP',
  estado           text not null default 'disponible', -- disponible|liquidado
  liquidado_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_wallet_creador on public.wallet_movimientos (creador_id);
create index if not exists idx_wallet_estado  on public.wallet_movimientos (estado);

-- 6) Datos bancarios de payout del creador. SENSIBLES: solo se leen/escriben
--    desde el servidor y solo se devuelven al propio creador o al admin.
--    NUNCA en logs ni en respuestas de API ajenas.
create table if not exists public.creador_datos_bancarios (
  creador_id  uuid primary key references auth.users(id) on delete cascade,
  titular     text,
  documento   text,
  banco       text,
  tipo_cuenta text, -- ahorros|corriente
  numero      text,
  updated_at  timestamptz not null default now()
);

-- 7) La orden de pago sabe a qué reto pertenece (purpose='reto') y arrastra
--    lo elegido en el formulario de inscripción (consentimiento, alias) hasta
--    que el webhook confirma el pago y crea al participante.
alter table public.payment_orders add column if not exists reto_id uuid references public.retos(id);
alter table public.payment_orders add column if not exists meta jsonb;

-- 8) RLS activado sin políticas: todo se toca SOLO desde el servidor (service
--    role, que salta RLS). Nadie con la anon key puede leer/escribir retos,
--    cupos, wallet ni datos bancarios.
alter table public.retos                   enable row level security;
alter table public.reto_premios            enable row level security;
alter table public.reto_cupos              enable row level security;
alter table public.reto_participantes      enable row level security;
alter table public.wallet_movimientos      enable row level security;
alter table public.creador_datos_bancarios enable row level security;
