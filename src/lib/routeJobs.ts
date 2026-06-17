// Helpers del sistema de jobs durable de generación de rutas.
// SOLO servidor: encola jobs (tabla route_jobs) y "despierta" al worker.
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Base URL absoluta del sitio (correo, self-chain del worker). */
export function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Encola (o re-encola) la generación de una ruta: deja el job en 'queued' con el
 * lease y el flag de correo reseteados, listo para que el worker lo reclame.
 * Resuelve el dueño y el total de lecciones desde la BD, así que los call sites
 * solo pasan el routeId. Idempotente por route_id.
 */
export async function enqueueRouteJob(routeId: string): Promise<void> {
  const sb = supabaseAdmin();

  const { data: route } = await sb.from("routes").select("owner_id").eq("id", routeId).single();
  let ownerEmail = "";
  if (route?.owner_id) {
    const { data: prof } = await sb.from("profiles").select("email").eq("id", route.owner_id).single();
    ownerEmail = prof?.email || "";
  }
  const { count } = await sb
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("route_id", routeId);

  await sb.from("route_jobs").upsert(
    {
      route_id: routeId,
      owner_id: route?.owner_id ?? null,
      owner_email: ownerEmail,
      status: "queued",
      total: count ?? 0,
      lease_until: null,
      notified_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "route_id" }
  );
}

/**
 * "Despierta" al worker con un POST fire-and-forget (mismo secreto que el cron).
 * No bloquea la respuesta al usuario: llamar dentro de `after(...)`. Si falla,
 * el cron de Vercel recoge el job igualmente en ≤1 min.
 */
export async function kickWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[RouteJobs] CRON_SECRET no configurado: el cron de Vercel recogerá el job.");
    return;
  }
  const url = `${getBaseUrl()}/api/route-jobs/worker`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      // No esperamos a que termine la generación: el worker responde rápido y
      // se auto-encadena. Damos un margen corto solo para entregar el disparo.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Silencioso a propósito: el cron es la red de seguridad.
    console.warn("[RouteJobs] No se pudo despertar al worker; el cron lo recogerá.");
  }
}
