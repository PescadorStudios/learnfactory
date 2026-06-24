-- ============================================================================
-- Inicio de estudio de una ruta (matrícula implícita).
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run.
--
-- Registra el momento en que un usuario ABRE una ruta para estudiarla, AUNQUE
-- todavía no haya completado ni la primera lección. Hasta ahora el único rastro
-- de que alguien "empezó" una ruta era su primer intento en `attempts`; con esto
-- el admin puede ver también las rutas que un usuario comenzó pero aún no avanzó.
--
-- Una fila por (usuario, ruta). El dueño de la ruta NO se registra como
-- estudiante de su propia ruta (igual que en student_count).
-- ============================================================================

create table if not exists public.route_starts (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  route_id   uuid not null references public.routes (id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (user_id, route_id)
);

create index if not exists route_starts_user_idx
  on public.route_starts (user_id, started_at desc);
create index if not exists route_starts_route_idx
  on public.route_starts (route_id);

-- RLS: solo desde el servidor (service role). Sin políticas anónimas.
alter table public.route_starts enable row level security;

-- Backfill: toda ruta donde un usuario ya tiene intentos cuenta como comenzada,
-- usando su primer intento como momento de inicio. Idempotente (ignora duplicados).
insert into public.route_starts (user_id, route_id, started_at)
select a.user_id, a.route_id, min(a.created_at)
from public.attempts a
join public.routes r on r.id = a.route_id
where a.user_id <> r.owner_id
group by a.user_id, a.route_id
on conflict (user_id, route_id) do nothing;
