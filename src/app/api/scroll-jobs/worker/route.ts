import { NextResponse, after } from "next/server";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AUDIO_BUCKET, STALE_GENERATING_MS } from "@/lib/routeGen";
import { getBaseUrl } from "@/lib/routeJobs";
import { kickScrollWorker } from "@/lib/scrollJobs";
import { generateTimeline } from "@/lib/scrollDirector";
import { sendVideosReadyEmail } from "@/lib/email/videosReady";
import type { Sintesis, LessonStep } from "@/lib/types";

// ============================================================================
// WORKER DURABLE DE GENERACIÓN DE CORTOS (Modo Scroll)
// ----------------------------------------------------------------------------
// Espejo del worker de rutas. Lo invocan (a) el cron de Vercel cada minuto y
// (b) el self-chain (kickScrollWorker) tras encolar. Reclama UN job con lease
// atómico, genera los timelines pendientes (un Gemini JSON por lección, sin TTS)
// en lotes acotados por tiempo y, al terminar, marca routes.videos_estado='listo'
// y manda el correo "videos listos". Si se acaba el presupuesto con trabajo
// pendiente, suelta el lease y se auto-encadena.
// ============================================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro

const LEASE_SECONDS = 300;
const TIME_BUDGET_MS = 200_000;
const BATCH = 5;            // timelines generados en paralelo por lote (solo JSON)
const MAX_ATTEMPTS = 3;     // reintentos por lección antes de rendirse

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

/** Cuenta el estado del TIMELINE entre las lecciones que pueden tener corto
 *  (status='ready' con audio_path). Esas son el universo de cortos de la ruta. */
async function statusCounts(sb: SupabaseClient, routeId: string): Promise<Counts> {
  const { data } = await sb.from("lessons").select("timeline_status, audio_path, status").eq("route_id", routeId);
  const rows = (data || []) as { timeline_status: string; audio_path: string | null; status: string }[];
  const c: Counts = { pending: 0, generating: 0, error: 0, ready: 0 };
  for (const r of rows) {
    if (r.status !== "ready" || !r.audio_path) continue;
    if (r.timeline_status === "ready") c.ready++;
    else if (r.timeline_status === "pending") c.pending++;
    else if (r.timeline_status === "generating") c.generating++;
    else if (r.timeline_status === "error") c.error++;
  }
  return c;
}

async function renewLease(sb: SupabaseClient, jobId: string, routeId: string) {
  const c = await statusCounts(sb, routeId);
  await sb.from("scroll_jobs").update({
    lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
    completed: c.ready,
    total: c.ready + c.pending + c.generating + c.error,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
}

/** Genera y guarda el timeline de UNA lección. Marca su propio estado
 *  (ready/error) — el worker solo orquesta lotes. */
async function generateOneTimeline(
  sb: SupabaseClient,
  routeId: string,
  sintesis: Sintesis,
  nodeId: string
) {
  try {
    const { data: lesson } = await sb
      .from("lessons")
      .select("title, content, concept_ids, audio_path, audio_duration")
      .eq("route_id", routeId)
      .eq("node_id", nodeId)
      .single();
    if (!lesson) throw new Error("Lección no encontrada.");
    if (!lesson.audio_path || !lesson.audio_duration) throw new Error("La lección no tiene audio listo.");

    const audioUrl = sb.storage.from(AUDIO_BUCKET).getPublicUrl(lesson.audio_path).data.publicUrl;
    const content = lesson.content as { steps?: LessonStep[] } | null;

    const timeline = await generateTimeline(
      {
        routeId,
        nodeId,
        title: lesson.title,
        steps: content?.steps ?? null,
        conceptIds: (lesson.concept_ids as string[]) || [],
        audioUrl,
        audioDurationSeconds: lesson.audio_duration as number,
      },
      sintesis
    );
    if (!timeline) throw new Error("El Director no produjo cues válidos.");

    await sb.from("lessons").update({
      timeline_json: timeline,
      timeline_status: "ready",
      timeline_error: null,
    }).eq("route_id", routeId).eq("node_id", nodeId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    console.error(`[ScrollWorker] timeline ${routeId}/${nodeId} falló:`, msg);
    await sb.from("lessons").update({
      timeline_status: "error",
      timeline_error: msg,
    }).eq("route_id", routeId).eq("node_id", nodeId);
  }
}

async function runJob(sb: SupabaseClient, job: JobRow, startedAt: number) {
  const routeId = job.route_id;

  const { data: route } = await sb.from("routes").select("topic, sintesis").eq("id", routeId).single();
  if (!route) {
    await sb.from("scroll_jobs").update({
      status: "error", lease_until: null, last_error: "Ruta no encontrada.", updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { jobId: job.id, status: "error", error: "route_not_found" };
  }
  const topic = route.topic as string;
  const sintesis = route.sintesis as Sintesis;

  await sb.from("routes").update({ videos_estado: "generando" }).eq("id", routeId);

  // Recuperar huérfanas: timelines "generating" viejos (proceso muerto) → pending.
  const staleCutoff = new Date(Date.now() - STALE_GENERATING_MS).toISOString();
  await sb.from("lessons").update({ timeline_status: "pending", timeline_error: null })
    .eq("route_id", routeId).eq("timeline_status", "generating")
    .lt("timeline_generating_at", staleCutoff);

  // Bucle de lotes acotado por presupuesto de tiempo.
  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    // Reintentar errores con intentos disponibles (dentro de esta invocación).
    await sb.from("lessons").update({ timeline_status: "pending", timeline_error: null })
      .eq("route_id", routeId).eq("timeline_status", "error").lt("timeline_attempts", MAX_ATTEMPTS);

    const { data: claimed, error: claimErr } = await sb.rpc("claim_scroll_timelines", {
      p_route_id: routeId,
      p_limit: BATCH,
    });
    if (claimErr) {
      console.error(`[ScrollWorker] claim_scroll_timelines falló (ruta ${routeId}):`, claimErr.message);
      break;
    }
    const nodeIds = ((claimed || []) as { node_id: string }[]).map(r => r.node_id);
    if (nodeIds.length === 0) break;

    console.log(`[ScrollWorker] ⚡ Lote de ${nodeIds.length} cortos (ruta ${routeId})...`);
    await Promise.allSettled(nodeIds.map(nid => generateOneTimeline(sb, routeId, sintesis, nid)));

    await renewLease(sb, job.id, routeId);
  }

  // ── Estado final ──────────────────────────────────────────────────────────
  const counts = await statusCounts(sb, routeId);
  const remaining = counts.pending + counts.generating;

  if (remaining > 0) {
    await sb.from("scroll_jobs").update({
      status: "running", lease_until: null, completed: counts.ready, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (counts.pending > 0) after(() => kickScrollWorker());
    return { jobId: job.id, remaining, chained: counts.pending > 0 };
  }

  if (counts.error > 0) {
    await sb.from("routes").update({ videos_estado: "error" }).eq("id", routeId);
    await sb.from("scroll_jobs").update({
      status: "error", lease_until: null,
      last_error: `${counts.error} corto(s) en error tras ${MAX_ATTEMPTS} intentos.`,
      completed: counts.ready, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { jobId: job.id, status: "error", errored: counts.error };
  }

  // Éxito total → videos listos + correo (idempotente vía notified_at).
  await sb.from("routes").update({ videos_estado: "listo" }).eq("id", routeId);
  await sb.from("scroll_jobs").update({
    status: "done", lease_until: null, completed: counts.ready, updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  const { data: notifyClaim } = await sb.from("scroll_jobs")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", job.id).is("notified_at", null)
    .select("id");
  if (notifyClaim && notifyClaim.length > 0 && job.owner_email) {
    const routeUrl = `${getBaseUrl()}/route/${routeId}`;
    const res = await sendVideosReadyEmail(job.owner_email, { topic, routeUrl, videosCount: counts.ready });
    if (!res.ok) console.error(`[ScrollWorker] Correo "videos listos" falló (ruta ${routeId}):`, res.error);
    else console.log(`[ScrollWorker] ✓ Correo "videos listos" enviado a ${job.owner_email}.`);
  }

  return { jobId: job.id, status: "done", videos: counts.ready };
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const startedAt = Date.now();

  const { data: claimed, error } = await sb.rpc("claim_scroll_job", { p_lease_seconds: LEASE_SECONDS });
  if (error) {
    console.error("[ScrollWorker] claim_scroll_job falló:", error.message);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }
  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as JobRow | undefined;
  if (!job) return NextResponse.json({ idle: true });

  try {
    const result = await runJob(sb, job, startedAt);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    console.error(`[ScrollWorker] Error fatal en job ${job.id}:`, e);
    await sb.from("scroll_jobs").update({ lease_until: null, last_error: msg }).eq("id", job.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// El cron de Vercel usa GET; el self-chain usa POST. Ambos exigen CRON_SECRET.
export const GET = handle;
export const POST = handle;
