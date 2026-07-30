-- ============================================================================
-- Muro de sesiones (freemium) + membresía mensual.
-- Idempotente: se puede correr varias veces sin daño.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run
--            (o: node scripts/apply-sql.mjs session-wall-setup.sql)
--
-- QUÉ HACE Y POR QUÉ IMPORTA
-- Estudiar sigue siendo gratis, pero POR SESIONES: 5 unidades en total sumando
-- los 4 modos (lección, podcast, corto de Modo Scroll, estación del Túnel). Al
-- agotarlas cae un bloqueo de 4 horas y se invita a la membresía mensual.
--
-- Quien lee esto: `src/lib/sessionGate.ts` (a través de las dos RPC de abajo) y
-- `src/app/gateActions.ts`. La aritmética pura y testeable vive aparte en
-- `src/lib/sessionBudget.ts`.
--
-- POR QUÉ UNA TABLA Y NO COLUMNAS EN profiles:
--   1. La idempotencia necesita UNA FILA POR UNIDAD con unique — repetir una
--      lección no puede volver a cobrar. Imposible con contadores escalares.
--   2. El correo "ya puedes volver" necesita un candado one-shot POR VENTANA que
--      el cron pueda escanear con índice parcial. Una columna en profiles la
--      pisaría la ventana siguiente.
--   3. Las métricas de conversión (bloqueos → pago) necesitan historia; las
--      columnas de perfil se destruyen en cada reinicio de ventana.
-- ============================================================================

-- ── 1) Ventanas de sesión ───────────────────────────────────────────────────
create table if not exists public.study_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  started_at         timestamptz not null default now(),
  units_used         int not null default 0,
  -- SNAPSHOT del presupuesto con el que se abrió la ventana: cambiar la
  -- constante (SESSION_WALL_BUDGET) NO reabre ni re-bloquea ventanas viejas.
  budget             int not null default 5,
  locked_at          timestamptz,
  -- null = ventana ABIERTA. Con valor = ventana cerrada por haber agotado el
  -- presupuesto; si ya pasó, la ventana está TERMINADA (nunca se reabre: la
  -- siguiente unidad abre una ventana nueva).
  locked_until       timestamptz,
  -- Candado one-shot del correo de desbloqueo (lo reclama el cron ANTES de
  -- enviar, para que dos ejecuciones solapadas no manden el aviso dos veces).
  unlock_notified_at timestamptz,
  -- Última unidad consumida → deep link del correo ("sigue donde lo dejaste").
  last_item_kind     text,
  last_item_key      text,
  last_route_id      uuid,
  updated_at         timestamptz not null default now()
);

-- EXACTAMENTE una ventana abierta por usuario. Este índice ES el candado que
-- evita que dos peticiones simultáneas abran dos ventanas (y regalen 5 + 5).
create unique index if not exists study_sessions_open_uniq
  on public.study_sessions (user_id) where locked_until is null;

-- El cron busca ventanas cuyo bloqueo venció y a las que aún no se avisó.
create index if not exists study_sessions_unlock_due_idx
  on public.study_sessions (locked_until) where unlock_notified_at is null;

create index if not exists study_sessions_user_idx
  on public.study_sessions (user_id, started_at desc);

-- ── 2) Ledger de unidades (la idempotencia) ─────────────────────────────────
create table if not exists public.study_units (
  session_id  uuid not null references public.study_sessions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('lesson', 'podcast', 'corto', 'tunel')),
  -- 'routeId:nodeId' para lección/podcast/corto; stationId para el Túnel.
  item_key    text not null,
  consumed_at timestamptz not null default now(),
  -- Repetir la MISMA unidad en la MISMA ventana no vuelve a cobrar.
  primary key (session_id, kind, item_key)
);

create index if not exists study_units_user_idx
  on public.study_units (user_id, consumed_at desc);

-- RLS: solo desde el servidor (service role). Sin políticas anónimas.
alter table public.study_sessions enable row level security;
alter table public.study_units    enable row level security;

-- ── 3) Membresía mensual ────────────────────────────────────────────────────
-- `plan` NO se renombra: lo comparan 6+ sitios. Se añade el vencimiento y la
-- marca de fundador; "tiene acceso" se DERIVA de estas columnas, nunca hay un
-- cron degradando el plan (así no se pierde la señal "fue miembro").
alter table public.profiles add column if not exists premium_until        timestamptz;
-- Fundadores = quienes compraron el Premium de PAGO ÚNICO. Acceso de por vida.
alter table public.profiles add column if not exists founder              boolean not null default false;
-- Recordatorios: se guarda el premium_until PARA EL QUE se avisó. Al renovar,
-- premium_until se mueve → deja de coincidir → el aviso se re-arma solo.
alter table public.profiles add column if not exists renewal_notified_for timestamptz;
alter table public.profiles add column if not exists lapsed_notified_for  timestamptz;
-- Ganchos para enchufar cobro automático más adelante SIN rehacer nada: todo el
-- resto de la app lee únicamente premium_until.
alter table public.profiles add column if not exists billing_provider        text;
alter table public.profiles add column if not exists billing_subscription_id text;
alter table public.profiles add column if not exists auto_renew              boolean not null default false;

-- Auditoría del periodo comprado (30 días por pago).
alter table public.payment_orders add column if not exists period_days int;

create index if not exists profiles_premium_until_idx
  on public.profiles (premium_until) where premium_until is not null;

-- ── 4) Backfill: respetar a quienes ya pagaron ──────────────────────────────
-- Autoprotegido y re-ejecutable sin fecha fija: todo miembro mensual nuevo
-- recibe premium_until en la misma escritura que plan='premium', así que nunca
-- puede coincidir con este WHERE. Correrlo dentro de un año sigue siendo correcto.
update public.profiles
set founder = true
where plan = 'premium'
  and premium_until is null
  and founder = false;

-- ── 5) RPC: consumir UNA unidad de forma atómica ────────────────────────────
-- Mismo patrón que claim_route_job (scripts/route-jobs-setup.sql): todo el
-- trabajo —candado de fila, insert del ledger, incremento y cierre— en UNA sola
-- transacción y un solo viaje. Un unique index por sí solo NO frenaría la 6ª
-- unidad (otro item_key = otra fila, sin conflicto), y un `update ... where
-- units_used < budget` no se puede emparejar transaccionalmente con el insert
-- del ledger desde el cliente.
--
-- IMPORTANTE: las columnas de salida van prefijadas con r_ a propósito. Sin el
-- prefijo choparían con las columnas reales (units_used, budget, locked_until,
-- session_id) y Postgres lanzaría "column reference is ambiguous" — el mismo
-- fallo documentado en claim_route_lessons.
create or replace function public.consume_study_unit(
  p_user       uuid,
  p_kind       text,
  p_item_key   text,
  p_route_id   uuid,
  p_budget     int,
  p_lock_hours int
)
returns table (
  r_allowed      boolean,
  r_already      boolean,
  r_units        int,
  r_budget       int,
  r_locked_until timestamptz,
  r_session_id   uuid
)
language plpgsql
as $$
declare
  v_id     uuid;
  v_units  int;
  v_budget int;
  v_locked timestamptz;
begin
  -- 0) ¿Hay un bloqueo VIGENTE? Entonces no se sirve nada y —crítico— NO se
  --    abre una ventana nueva. Sin esta comprobación el paso 1 no encontraría
  --    ventana abierta y el paso 2 crearía otra, regalando 5 unidades más.
  select s.id, s.units_used, s.budget, s.locked_until
    into v_id, v_units, v_budget, v_locked
  from public.study_sessions s
  where s.user_id = p_user
    and s.locked_until is not null
    and s.locked_until > now()
  order by s.locked_until desc
  limit 1
  for update;

  if v_id is not null then
    return query select false, false, v_units, v_budget, v_locked, v_id;
    return;
  end if;

  -- 1) Ventana abierta del usuario, con candado de fila.
  select s.id, s.units_used, s.budget, s.locked_until
    into v_id, v_units, v_budget, v_locked
  from public.study_sessions s
  where s.user_id = p_user and s.locked_until is null
  for update;

  -- 2) No hay ninguna → abrir una. Si otra petición la abre a la vez, el índice
  --    parcial la rechaza y nos quedamos con la suya.
  if v_id is null then
    begin
      insert into public.study_sessions (user_id, budget)
      values (p_user, p_budget)
      returning
        study_sessions.id, study_sessions.units_used,
        study_sessions.budget, study_sessions.locked_until
        into v_id, v_units, v_budget, v_locked;
    exception when unique_violation then
      select s.id, s.units_used, s.budget, s.locked_until
        into v_id, v_units, v_budget, v_locked
      from public.study_sessions s
      where s.user_id = p_user and s.locked_until is null
      for update;
    end;
  end if;

  -- 3) Ledger. `on conflict do nothing` + FOUND = la idempotencia: si la unidad
  --    ya estaba contada en esta ventana, NO se vuelve a cobrar.
  insert into public.study_units (session_id, user_id, kind, item_key)
  values (v_id, p_user, p_kind, p_item_key)
  on conflict do nothing;

  if not found then
    return query select true, true, v_units, v_budget, v_locked, v_id;
    return;
  end if;

  -- 4) Cobrar. La unidad que AGOTA el presupuesto SÍ se sirve y el muro cae
  --    justo después (budget 5 = cinco unidades entregadas, no cuatro).
  v_units := v_units + 1;
  if v_units >= v_budget then
    v_locked := now() + make_interval(hours => p_lock_hours);
  end if;

  update public.study_sessions s
  set units_used     = v_units,
      locked_at      = case when v_locked is not null then now() else s.locked_at end,
      locked_until   = v_locked,
      last_item_kind = p_kind,
      last_item_key  = p_item_key,
      last_route_id  = coalesce(p_route_id, s.last_route_id),
      updated_at     = now()
  where s.id = v_id;

  return query select true, false, v_units, v_budget, v_locked, v_id;
end;
$$;

-- ── 6) RPC: leer el estado sin cobrar (medidor y pantalla de bloqueo) ───────
-- Devuelve la ventana abierta, o el bloqueo vigente, o 0 filas (= sesión nueva,
-- cero unidades gastadas). Las ventanas ya terminadas se ignoran.
create or replace function public.study_gate_state(p_user uuid)
returns table (
  r_units        int,
  r_budget       int,
  r_locked_until timestamptz,
  r_session_id   uuid
)
language sql
stable
as $$
  select s.units_used, s.budget, s.locked_until, s.id
  from public.study_sessions s
  where s.user_id = p_user
    and (s.locked_until is null or s.locked_until > now())
  order by s.started_at desc
  limit 1;
$$;
