-- ============================================================================
-- Reanudar microlección: progreso parcial por (usuario, ruta, nodo).
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run.
--
-- Guarda un "borrador" con el paso actual y los acumuladores (xp, atención,
-- puntuaciones socráticas, etc.) mientras el usuario avanza en una microlección.
-- Al COMPLETAR la lección (se registra el intento en `attempts`) el borrador se
-- borra. Si el usuario elige "empezar de nuevo", también se borra. Por eso un
-- intento sigue contándose solo al completar: el borrador es solo para reanudar.
-- ============================================================================

create table if not exists public.lesson_progress (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  route_id   uuid not null references public.routes (id) on delete cascade,
  node_id    text not null,
  state      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, route_id, node_id)
);

create index if not exists lesson_progress_user_route_idx
  on public.lesson_progress (user_id, route_id);

-- RLS: solo desde el servidor (service role). Sin políticas anónimas.
alter table public.lesson_progress enable row level security;
