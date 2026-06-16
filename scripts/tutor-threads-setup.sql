-- ============================================================================
-- Tutor de ruta: MÚLTIPLES conversaciones (threads) por (usuario, ruta).
-- Idempotente: puedes ejecutarlo varias veces sin romper nada.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run.
--
-- Antes había UN historial lineal por (user_id, route_id) en tutor_messages.
-- Ahora cada mensaje pertenece a un thread (tutor_threads), de modo que el
-- usuario puede manejar varios temas en paralelo, cada uno con su contexto.
-- El backfill agrupa los mensajes existentes en un thread "Conversación" por
-- cada (usuario, ruta), así no se pierde ninguna conversación previa.
-- ============================================================================

-- ── Threads ──────────────────────────────────────────────────────────────────
create table if not exists public.tutor_threads (
  id         uuid primary key default gen_random_uuid (),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  route_id   uuid not null references public.routes (id) on delete cascade,
  title      text not null default 'Conversación',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutor_threads_user_route_idx
  on public.tutor_threads (user_id, route_id, updated_at desc);

-- RLS: se tocan SOLO desde el servidor (service role salta RLS). Sin políticas
-- anónimas → nadie con la anon key puede leer/escribir.
alter table public.tutor_threads enable row level security;

-- ── Vincular mensajes a un thread ─────────────────────────────────────────────
alter table public.tutor_messages
  add column if not exists thread_id uuid references public.tutor_threads (id) on delete cascade;

-- Backfill: cada (usuario, ruta) con mensajes huérfanos → un thread que los agrupa.
do $$
declare
  r          record;
  new_thread uuid;
begin
  for r in
    select distinct user_id, route_id
    from public.tutor_messages
    where thread_id is null
  loop
    insert into public.tutor_threads (user_id, route_id, title)
    values (r.user_id, r.route_id, 'Conversación')
    returning id into new_thread;

    update public.tutor_messages
       set thread_id = new_thread
     where user_id = r.user_id
       and route_id = r.route_id
       and thread_id is null;
  end loop;
end $$;

create index if not exists tutor_messages_thread_idx
  on public.tutor_messages (thread_id, created_at);
