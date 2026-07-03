// Aplica un archivo SQL a la base de datos (idempotente si el SQL lo es).
// Uso: node scripts/apply-sql.mjs scripts/retos-setup.sql
import { config } from "dotenv";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: ".env.local" });

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/apply-sql.mjs <archivo.sql>");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

// Quitar sslmode de la URL (pisa la config ssl del cliente) y aceptar el
// certificado autofirmado del pooler de Supabase (igual que setup-db.mjs).
const connectionString = process.env.POSTGRES_URL_NON_POOLING
  .replace(/[?&]sslmode=[^&]+/, m => (m.startsWith("?") ? "?" : ""))
  .replace(/\?$/, "");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("✓ Conectado a Postgres");
await client.query(sql);
console.log(`✓ Aplicado: ${file}`);
await client.end();
