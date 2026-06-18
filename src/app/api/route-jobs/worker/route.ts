import { NextResponse, after } from "next/server";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildLessonPlan,
  generateOneLesson,
  prepareRoute,
  generateAndStoreCover,
  flattenNodes,
  STALE_GENERATING_MS,
} from "@/lib/routeGen";
import { kickWorker, getBaseUrl } from "@/lib/routeJobs";
import { sendRouteReadyEmail } from "@/lib/email/routeReady";

// ============================================================================
// WORKER DURABLE DE GENERACIÓN DE RUTAS
// ----------------------------------------------------------------------------
// Lo invocan: (a) el cron de Vercel cada minuto (red de seguridad) y (b) el
// self-chain (kickWorker) tras crear/reanudar una ruta. Reclama UN job con un
// lease atómico, genera las lecciones pendientes en lotes acotados por tiempo y,
// al terminar, marca el job y manda el correo "ruta lista". Si se acaba el
// presupuesto de tiempo con trabajo pendiente, suelta el lease y se auto-encadena.
// ============================================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro

// Lease ≈ maxDuration: un lote de lecciones con audio (TTS) puede tardar varios
// minutos; el lease debe cubrir toda la invocación para que el cron no arranque
// un segundo worker sobre la misma ruta. Se renueva entre lotes.
const LEASE_SECONDS = 300;
const TIME_BUDGET_MS = 200_000;     // no empezar lotes nuevos pasado esto (margen bajo maxDuration)
const BATCH = 4;                    // lecciones generadas en paralelo por lote
const MAX_ATTEMPTS = 3;             // reintentos por lección antes de rendirse

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  const provided = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret) return false;
  return safeEqual(provided, secret);
}

interface JobRow {
  id: string;
  route_id: string;
  owner_email: string | null;
}

interface Counts {
  pending: number;
  generating: number;
  error: number;
  ready: number;
}

/** Cuenta lecciones por estado (pending/generating/error solo no-debate). */
async function statusCounts(sb: SupabaseClient, routeId: string): Promise<Counts> {
  const { data } = await sb.from("lessons").select("status, node_type").eq("route_id", routeId);
  const rows = (data || []) as { status: string; node_type: string }[];
  const c: Counts = { pending: 0, generating: 0, error: 0, ready: 0 };
  for (const r of rows) {
    if (r.status === "ready") c.ready++;
    if (r.node_type === "debate") continue;
    if (r.status === "pending") c.pending++;
    else if (r.status === "generating") c.generating++;
    else if (r.status === "error") c.error++;
  }
  return c;
}

async function renewLease(sb: SupabaseClient, jobId: string, routeId: string, total: number) {
  const counts = await statusCounts(sb, routeId);
  await sb.from("route_jobs").update({
    lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
    completed: counts.ready,
    total,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
}

async function runJob(sb: SupabaseClient, job: JobRow, startedAt: number) {
  const routeId = job.route_id;

  // Garantiza síntesis maestra + placeholders de lecciones (los genera si la ruta
  // nació con árbol vacío, como hace ahora createRoute). La síntesis pesada vive
  // aquí, no en el request, así createRoute responde al instante.
  const prep = await prepareRoute(routeId);
  if (!prep.ok) {
    // Síntesis falló (fuentes ilegibles, IA caída): error visible + devolver el
    // crédito (credits=0) para no cobrar una creación fallida.
    await sb.from("routes").update({ status: "error", gen_notice: prep.error, credits: 0 }).eq("id", routeId);
    await sb.from("route_jobs").update({
      status: "error", lease_until: null, last_error: prep.error, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { jobId: job.id, status: "error", phase: "synthesis", error: prep.error };
  }

  const { topic, tree, sintesis, cover } = prep.data;
  if (cover) after(() => generateAndStoreCover(routeId, topic, cover.prompt, cover.refs));

  const plan = buildLessonPlan(tree);
  await sb.from("route_jobs").update({ total: flattenNodes(tree).length }).eq("id", job.id);

  await sb.from("routes").update({ status: "generating" }).eq("id", routeId);

  // Recuperar huérfanas: lecciones "generating" viejas (proceso muerto) → pending.
  const staleCutoff = new Date(Date.now() - STALE_GENERATING_MS).toISOString();
  await sb.from("lessons").update({ status: "pending", error: null })
    .eq("route_id", routeId).eq("status", "generating")
    .lt("generating_at", staleCutoff).neq("node_type", "debate");

  // Bucle de lotes acotado por presupuesto de tiempo.
  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    // Reintentar errores con intentos disponibles (dentro de esta misma invocación).
    await sb.from("lessons").update({ status: "pending", error: null })
      .eq("route_id", routeId).eq("status", "error")
      .neq("node_type", "debate").lt("attempts", MAX_ATTEMPTS);

    const { data: claimed, error: claimErr } = await sb.rpc("claim_route_lessons", {
      p_route_id: routeId,
      p_limit: BATCH,
    });
    if (claimErr) {
      console.error(`[Worker] claim_route_lessons falló (ruta ${routeId}):`, claimErr.message);
      break;
    }
    const nodeIds = ((claimed || []) as { node_id: string }[]).map(r => r.node_id);
    if (nodeIds.length === 0) break;

    console.log(`[Worker] ⚡ Lote de ${nodeIds.length} lecciones (ruta ${routeId})...`);
    await Promise.allSettled(
      nodeIds.map(nid => {
        const entry = plan.get(nid);
        if (!entry) return Promise.resolve();
        return generateOneLesson(
          routeId, topic, sintesis, entry.node, entry.studiedConceptIds, entry.attentionMode
        );
      })
    );

    await renewLease(sb, job.id, routeId, plan.size);
  }

  // ── Estado final ──────────────────────────────────────────────────────────
  const counts = await statusCounts(sb, routeId);
  const remaining = counts.pending + counts.generating;

  if (remaining > 0) {
    // Queda trabajo: soltar el lease para que otro worker/el cron lo reclame.
    await sb.from("route_jobs").update({
      status: "running", lease_until: null, completed: counts.ready, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    // Auto-encadenar SOLO si hay lecciones reclamables ya (pending): así no
    // entramos en un bucle vacío con lecciones "generating" huérfanas que aún no
    // cruzan la ventana de stale; de esas se encarga el cron (≤1 min).
    if (counts.pending > 0) after(() => kickWorker());
    return { jobId: job.id, remaining, chained: counts.pending > 0 };
  }

  // No queda pendiente: la ruta es usable (los errores se reintentan por lección).
  await sb.from("routes").update({ status: "ready" }).eq("id", routeId);

  if (counts.error > 0) {
    await sb.from("route_jobs").update({
      status: "error", lease_until: null,
      last_error: `${counts.error} lección(es) en error tras ${MAX_ATTEMPTS} intentos.`,
      completed: counts.ready, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { jobId: job.id, status: "error", errored: counts.error };
  }

  // Éxito total → done + correo "ruta lista" (idempotente vía notified_at).
  await sb.from("route_jobs").update({
    status: "done", lease_until: null, completed: counts.ready, updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  const { data: notifyClaim } = await sb.from("route_jobs")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", job.id).is("notified_at", null)
    .select("id");
  if (notifyClaim && notifyClaim.length > 0 && job.owner_email) {
    const routeUrl = `${getBaseUrl()}/tree?route=${routeId}`;
    const res = await sendRouteReadyEmail(job.owner_email, {
      topic, routeUrl, lessonsCount: counts.ready,
    });
    if (!res.ok) console.error(`[Worker] Correo "ruta lista" falló (ruta ${routeId}):`, res.error);
    else console.log(`[Worker] ✓ Correo "ruta lista" enviado a ${job.owner_email}.`);
  }

  return { jobId: job.id, status: "done", lessons: counts.ready };
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const startedAt = Date.now();

  const { data: claimed, error } = await sb.rpc("claim_route_job", { p_lease_seconds: LEASE_SECONDS });
  if (error) {
    console.error("[Worker] claim_route_job falló:", error.message);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }
  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as JobRow | undefined;
  if (!job) return NextResponse.json({ idle: true });

  try {
    const result = await runJob(sb, job, startedAt);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    console.error(`[Worker] Error fatal en job ${job.id}:`, e);
    // Soltar el lease para que el cron lo reintente.
    await sb.from("route_jobs").update({ lease_until: null, last_error: msg }).eq("id", job.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// El cron de Vercel usa GET; el self-chain usa POST. Ambos exigen CRON_SECRET.
export const GET = handle;
export const POST = handle;
