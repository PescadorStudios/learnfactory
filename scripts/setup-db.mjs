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

-- RLS activado sin políticas: la API anónima queda bloqueada; el service role la salta.
alter table public.profiles enable row level security;
alter table public.routes enable row level security;
alter table public.lessons enable row level security;
alter table public.attempts enable row level security;
alter table public.concept_mastery enable row level security;
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
  if (!buckets?.some(b => b.name === "lesson-audio")) {
    const { error } = await supabase.storage.createBucket("lesson-audio", {
      public: true,
      fileSizeLimit: "20MB",
      allowedMimeTypes: ["audio/wav"],
    });
    if (error) throw error;
    console.log("✓ Bucket 'lesson-audio' creado (público)");
  } else {
    console.log("✓ Bucket 'lesson-audio' ya existía");
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
    .upsert({ id: adminUser.id, email: ADMIN_EMAIL, role: "admin" }, { onConflict: "id" });
  if (profErr) throw profErr;
  console.log("✓ Profile de admin con role 'admin'");

  console.log("\nSetup completo ✅");
}

main().catch(e => {
  console.error("Setup falló:", e);
  process.exit(1);
});
