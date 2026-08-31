-- ============================================================================
-- Modo Lectura Veloz (RSVP) — documentos privados + preferencias de lectura.
-- Idempotente: se puede correr varias veces sin daño.
-- Cómo usar: Supabase → SQL Editor → pega esto → Run
--            (o: node scripts/apply-sql.mjs scripts/lectura-veloz-setup.sql)
--
-- QUÉ HACE Y POR QUÉ IMPORTA
-- Los otros tres modos (Podcast, Modo Scroll, El Túnel) consumen contenido que
-- generó la IA para una ruta. Este consume el material que YA tiene el usuario:
-- pega el texto de un libro o suelta un PDF, y la app se lo pasa palabra a
-- palabra a alta velocidad con la letra pivote en rojo.
--
-- PRIVACIDAD POR ESQUEMA, NO POR FLAG
-- Se usará con libros de terceros, así que la privacidad no puede depender de
-- que nadie ponga un booleano en true por error. Esta tabla NO tiene:
--   · `visibility` / `public` / `shared_with` → no existe un estado "público"
--     representable. No hay nada que activar.
--   · `storage_path` ni bucket → el PDF nunca sale del dispositivo: se extrae
--     en el navegador y solo viaja el texto. Además, los tres buckets del
--     proyecto (route-covers, avatars, lesson-audio) son PÚBLICOS.
--   · FK a `routes` → queda estructuralmente fuera de feedRanker, del buscador
--     (/?q=) y de /u/<username>, que consultan `routes`.
-- Y el texto no se manda a ningún LLM, ni siquiera para sugerir el título.
--
-- Quien lee esto: src/app/velozActions.ts. El motor puro y testeable (ORP,
-- chunks, duraciones, secciones) vive aparte en src/lib/rsvp.ts.
-- ============================================================================

-- ── 1) El documento privado (y su progreso) ─────────────────────────────────
-- El progreso va en la MISMA fila y no en una tabla aparte porque la relación
-- es 1:1 por construcción: el documento tiene un único dueño, así que nunca
-- puede haber dos lectores del mismo documento.
create table if not exists public.reading_docs (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  title           text not null,
  author          text,
  source          text not null default 'pegado' check (source in ('pegado', 'pdf')),
  source_filename text,
  -- El TEXTO vive aquí, no en Storage: no existe ningún bucket privado en el
  -- proyecto y montar uno solo para esto añadiría URLs firmadas, caducidad y un
  -- punto de fuga. Un libro son ~1 MB de texto: una columna text lo aguanta.
  content         text not null default '',
  char_count      int  not null default 0,
  word_count      int  not null default 0,
  -- sha-256 del contenido normalizado. Subir dos veces el mismo libro no crea
  -- dos entradas; el índice único de abajo es lo que lo hace idempotente.
  content_hash    text,
  -- Importación por partes (un libro no cabe en un solo server action):
  -- 'importing' hasta que llega la última parte. Los 'importing' se filtran del
  -- listado, así que un import a medias nunca ensucia la biblioteca.
  import_status   text not null default 'ready' check (import_status in ('importing', 'ready')),
  next_part       int  not null default 0,
  -- ── Progreso ──────────────────────────────────────────────────────────────
  -- OJO: el cursor es ÍNDICE DE PALABRA, no de chunk. Si fuera de chunk, pasar
  -- de "1 palabra" a "3 palabras" desplazaría el punto de reanudado.
  cursor_word     int  not null default 0,
  seconds_read    int  not null default 0,
  last_read_at    timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists reading_docs_owner_idx
  on public.reading_docs (owner_id, updated_at desc);

-- Dedupe POR DUEÑO. Parcial porque los 'importing' aún no tienen hash.
-- Deliberadamente NO se deduplica entre cuentas: eso revelaría qué lee otra
-- gente, que es exactamente lo que este modo no puede permitirse.
create unique index if not exists reading_docs_owner_hash_uniq
  on public.reading_docs (owner_id, content_hash) where content_hash is not null;

-- ── 2) El ecualizador de lectura ────────────────────────────────────────────
-- Una fila por USUARIO, no por documento: el ritmo de lectura es del lector. Si
-- viviera en el documento habría que reconfigurar cada libro nuevo.
create table if not exists public.reading_prefs (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  -- El tope de 1000 va en la BASE y no solo en la UI: acota la frecuencia de
  -- cambio a ~16 Hz, que es donde el riesgo fotosensible deja de ser hipotético.
  wpm             int  not null default 300 check (wpm between 100 and 1000),
  chunk_size      int  not null default 1   check (chunk_size between 1 and 4),
  font_size       int  not null default 48  check (font_size between 24 and 96),
  dynamic_pauses  boolean not null default true,
  long_word_boost boolean not null default true,
  -- Alternativa al pivote rojo para daltonismo rojo-verde: sobre el fondo verde
  -- del modo, el rojo es justo el eje que un protanope no distingue.
  highlight_style text not null default 'rojo'
                  check (highlight_style in ('rojo', 'subrayado', 'negrita')),
  -- Recordatorio de descanso (regla 20-20-20). 0 = desactivado.
  break_minutes   int  not null default 20 check (break_minutes between 0 and 120),
  -- Aviso de fotosensibilidad aceptado. Se muestra UNA vez por cuenta.
  warning_ack_at  timestamptz,
  updated_at      timestamptz not null default now()
);

-- ── 3) Gamificación (espejo de podcast_seconds / scroll_seconds) ────────────
alter table public.profiles add column if not exists reading_seconds int not null default 0;
alter table public.profiles add column if not exists reading_words   int not null default 0;

-- ── 4) RLS ──────────────────────────────────────────────────────────────────
-- RLS: solo desde el servidor (service role). Sin políticas anónimas.
-- Aquí importa MÁS que en el resto del proyecto: son libros de terceros. Sin
-- políticas, ni anon ni authenticated leen NI UNA fila aunque se filtre la
-- publishable key.
alter table public.reading_docs  enable row level security;
alter table public.reading_prefs enable row level security;

-- ── 5) El muro de sesiones acepta el kind nuevo ─────────────────────────────
-- El check original es INLINE en la columna (scripts/session-wall-setup.sql),
-- así que Postgres lo nombró study_units_kind_check. Comprobar con:
--   select conname from pg_constraint where conrelid = 'public.study_units'::regclass;
-- drop + add es idempotente: la 2ª ejecución tira el que acabamos de crear y lo
-- repone idéntico. El add revalida las filas existentes, y todas las kinds
-- actuales están en la lista nueva, así que no puede fallar.
--
-- ORDEN DE DESPLIEGUE: ESTE SQL PRIMERO, EL CÓDIGO DESPUÉS. Al revés, el insert
-- del ledger falla → consume_study_unit devuelve error → sessionGate hace
-- fail-open: no bloquea a nadie, pero regala unidades.
alter table public.study_units drop constraint if exists study_units_kind_check;
alter table public.study_units
  add  constraint study_units_kind_check
  check (kind in ('lesson', 'podcast', 'corto', 'tunel', 'lectura'));
