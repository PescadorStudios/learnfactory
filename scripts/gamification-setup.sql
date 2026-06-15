-- ============================================================================
-- Gamificación de escucha (Podcast) + recorrido (Túnel) y Tutor por ruta.
-- Idempotente: se puede correr varias veces sin daño.
--
-- - profiles.podcast_seconds: tiempo total escuchado en modo Podcast (segundos).
-- - profiles.tunnel_lessons:  lecciones/estaciones completadas en el Túnel.
--   Ambos son contadores GLOBALES por usuario; el nivel se deriva en el cliente
--   (src/lib/listeningLevels.ts), no se guarda.
--
-- - tutor_messages: memoria del Agente/Tutor, por (usuario, ruta). El tutor vive
--   en la página de la ruta (árbol) y responde dudas globales de TODA la ruta.
-- ============================================================================

alter table public.profiles add column if not exists podcast_seconds int not null default 0;
alter table public.profiles add column if not exists tunnel_lessons  int not null default 0;

create table if not exists public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  role text not null,            -- 'user' | 'tutor'
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists tutor_messages_user_route_idx
  on public.tutor_messages(user_id, route_id, created_at);

-- RLS activado SIN políticas (igual que el resto de tablas del proyecto): la API
-- anónima/authenticated queda bloqueada; el acceso pasa solo por el service role
-- (server actions en src/app/tutorActions.ts). NO crear políticas para anon.
alter table public.tutor_messages enable row level security;
