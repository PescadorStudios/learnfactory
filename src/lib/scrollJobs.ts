// Helpers del sistema de jobs durable de generación de videos (Modo Scroll).
// SOLO servidor: encola jobs (tabla scroll_jobs) y "despierta" al worker.
// Espejo de routeJobs.ts; reutiliza getBaseUrl y el mismo CRON_SECRET.
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBaseUrl } from "@/lib/routeJobs";

/**
 * Encola (o re-encola) la generación de los cortos de una ruta: deja el job en
 * 'queued' con el lease y el flag de correo reseteados, listo para que el worker
 * lo reclame. Resuelve dueño y total (lecciones con audio listo) desde la BD, así
 * que los call sites solo pasan el routeId. Idempotente por route_id.
 */
export async function enqueueScrollJob(routeId: string): Promise<void> {
  const sb = supabaseAdmin();

  const { data: route } = await sb.from("routes").select("owner_id").eq("id", routeId).single();
  let ownerEmail = "";
  if (route?.owner_id) {
    const { data: prof } = await sb.from("profiles").select("email").eq("id", route.owner_id).single();
    ownerEmail = prof?.email || "";
  }
  // Solo las lecciones con audio listo tendrán corto (el visual se sincroniza al
  // audio existente). Ese es el "total" del job.
  const { count } = await sb
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("route_id", routeId)
    .eq("status", "ready")
    .not("audio_path", "is", null);

  await sb.from("scroll_jobs").upsert(
    {
      route_id: routeId,
      owner_id: route?.owner_id ?? null,
      owner_email: ownerEmail,
      status: "queued",
      total: count ?? 0,
      completed: 0,
      lease_until: null,
      notified_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "route_id" }
  );
}

/**
 * "Despierta" al worker de scroll con un POST fire-and-forget (mismo secreto que
 * el cron). No bloquea la respuesta al usuario: llamar dentro de `after(...)`. Si
 * falla, el cron de Vercel recoge el job igualmente en ≤1 min.
 */
export async function kickScrollWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[ScrollJobs] CRON_SECRET no configurado: el cron de Vercel recogerá el job.");
    return;
  }
  const url = `${getBaseUrl()}/api/scroll-jobs/worker`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Silencioso a propósito: el cron es la red de seguridad.
    console.warn("[ScrollJobs] No se pudo despertar al worker; el cron lo recogerá.");
  }
}
