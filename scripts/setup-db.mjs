// Setup idempotente de la base de datos de LearnFactory.
// Uso: node scripts/setup-db.mjs
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

config({ path: ".env.local" });

const ADMIN_EMAIL = "mauricioduque2323@gmail.com";

const SCHEMA_SQL = `
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role text not null default 'user',
  created_at timestamptz not null default now()
);
-- Perfil social (idempotente para instalaciones existentes):
alter table public.profiles add column if not exists username text unique;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists banner_path text;
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists route_quota int not null default 1;
alter table public.profiles add column if not exists premium_since timestamptz;

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null,
  sources text,
  sintesis jsonb not null,
  tree jsonb not null,
  status text not null default 'generating',
  created_at timestamptz not null default now()
);
-- Biblioteca pública + portada + contadores (idempotente):
alter table public.routes add column if not exists visibility text not null default 'public';
alter table public.routes add column if not exists description text;
alter table public.routes add column if not exists cover_path text;
alter table public.routes add column if not exists cover_prompt text;
alter table public.routes add column if not exists rating_sum int not null default 0;
alter table public.routes add column if not exists rating_count int not null default 0;
alter table public.routes add column if not exists student_count int not null default 0;
alter table public.routes add column if not exists favorite_count int not null default 0;
create index if not exists routes_visibility_idx on public.routes(visibility);
create index if not exists routes_owner_idx on public.routes(owner_id);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  title text not null,
  concept_ids jsonb not null default '[]',
  content jsonb,
  audio_questions jsonb,
  audio_duration real,
  audio_path text,
  status text not null default 'pending',
  error text,
  generating_at timestamptz,
  unique(route_id, node_id)
);
-- Para instalaciones existentes (idempotente):
alter table public.lessons add column if not exists generating_at timestamptz;

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  node_id text not null,
  stars real not null default 0,
  passed boolean not null default true,
  xp int not null default 0,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists attempts_user_route_idx on public.attempts(user_id, route_id);

create table if not exists public.concept_mastery (
  user_id uuid not null references public.profiles(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  concept_id text not null,
  score int not null default 0,
  attempts int not null default 0,
  last_reviewed timestamptz not null default now(),
  primary key (user_id, route_id, concept_id)
);

-- ── Grafo social ──
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id)
);
create index if not exists follows_following_idx on public.follows(following_id);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);

create table if not exists public.route_ratings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  stars int not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);

-- ── Pagos (Bold) ──
create table if not exists public.payment_orders (
  order_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount int not null,
  currency text not null default 'COP',
  purpose text not null default 'premium',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.bold_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id text unique not null,
  transaction_type text not null,
  amount_total numeric not null default 0,
  amount_currency text default 'COP',
  order_reference text,
  raw_data jsonb not null,
  customer_data jsonb,
  created_at timestamptz not null default now()
);

-- RLS activado sin políticas: la API anónima queda bloqueada; el service role la salta.
alter table public.profiles enable row level security;
alter table public.routes enable row level security;
alter table public.lessons enable row level security;
alter table public.attempts enable row level security;
alter table public.concept_mastery enable row level security;
alter table public.follows enable row level security;
alter table public.favorites enable row level security;
alter table public.route_ratings enable row level security;
alter table public.payment_orders enable row level security;
alter table public.bold_transactions enable row level security;

-- ── Realtime (websockets) para el progreso de generación ──
-- Políticas de SOLO LECTURA para usuarios autenticados: necesarias para que
-- Supabase Realtime (postgres_changes) entregue los updates de lecciones.
-- Las escrituras siguen pasando únicamente por el service role.
drop policy if exists routes_read on public.routes;
create policy routes_read on public.routes for select to authenticated
  using (visibility = 'public' or owner_id = (select auth.uid()));

drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons for select to authenticated
  using (exists (
    select 1 from public.routes r
    where r.id = route_id and (r.visibility = 'public' or r.owner_id = (select auth.uid()))
  ));

-- Añadir las tablas a la publicación de Realtime (idempotente)
do $$ begin
  alter publication supabase_realtime add table public.lessons;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.routes;
exception when duplicate_object then null; end $$;
`;

async function main() {
  // 1) Esquema vía Postgres directo
  // Quitar sslmode de la URL (pisa la config ssl del cliente) y aceptar el
  // certificado autofirmado del pooler de Supabase
  const connectionString = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]+/, m => (m.startsWith("?") ? "?" : "")).replace(/\?$/, "");
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("✓ Conectado a Postgres");
  await client.query(SCHEMA_SQL);
  console.log("✓ Esquema creado/verificado (profiles, routes, lessons, attempts, concept_mastery)");
  await client.end();

  // 2) Bucket de audio
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: buckets } = await supabase.storage.listBuckets();
  const existing = new Set((buckets || []).map(b => b.name));

  const bucketSpecs = [
    { name: "lesson-audio", opts: { public: true, fileSizeLimit: "20MB", allowedMimeTypes: ["audio/wav"] } },
    { name: "avatars", opts: { public: true, fileSizeLimit: "5MB", allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] } },
    { name: "route-covers", opts: { public: true, fileSizeLimit: "10MB", allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] } },
  ];

  for (const { name, opts } of bucketSpecs) {
    if (!existing.has(name)) {
      const { error } = await supabase.storage.createBucket(name, opts);
      if (error && !/already exists/i.test(error.message)) throw error;
      console.log(error ? `✓ Bucket '${name}' ya existía` : `✓ Bucket '${name}' creado (público)`);
    } else {
      console.log(`✓ Bucket '${name}' ya existía`);
    }
  }

  // 3) Usuario admin
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  let adminUser = list.users.find(u => u.email === ADMIN_EMAIL);

  if (!adminUser) {
    const password = "LF-" + crypto.randomBytes(9).toString("base64url");
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    adminUser = data.user;
    console.log("✓ Usuario admin creado:");
    console.log(`    Email:      ${ADMIN_EMAIL}`);
    console.log(`    Contraseña: ${password}`);
    console.log("    (Guárdala: solo se muestra esta vez)");
  } else {
    console.log(`✓ Usuario admin ya existía (${ADMIN_EMAIL})`);
  }

  const { error: profErr } = await supabase
    .from("profiles")
    .upsert(
      { id: adminUser.id, email: ADMIN_EMAIL, role: "admin", plan: "premium", route_quota: 999 },
      { onConflict: "id" }
    );
  if (profErr) throw profErr;
  console.log("✓ Profile de admin con role 'admin' (premium)");

  // Backfill: asignar username al admin si no tiene
  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", adminUser.id)
    .single();
  if (adminProfile && !adminProfile.username) {
    await supabase.from("profiles").update({ username: "mauricio", display_name: "Mauricio" }).eq("id", adminUser.id);
    console.log("✓ Username del admin: @mauricio");
  }

  console.log("\nSetup completo ✅");
}

main().catch(e => {
  console.error("Setup falló:", e);
  process.exit(1);
});
