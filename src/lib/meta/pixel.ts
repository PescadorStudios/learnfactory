"use client";

// Helper de cliente para disparar eventos de Meta con DEDUPLICACIÓN:
//   1) genera un event_id único,
//   2) dispara el Pixel del navegador con ese event_id (fbq ... {eventID}),
//   3) manda el gemelo server-side por la CAPI con el MISMO event_id.
// Meta une ambos por el event_id → no se cuenta doble y, si el navegador
// bloquea el Pixel, el server igual reporta la conversión.

import { trackMetaEvent } from "@/app/metaActions";
import type { MetaEventName } from "@/lib/meta/capi";

type Fbq = (...args: unknown[]) => void;
declare global {
  interface Window {
    fbq?: Fbq;
  }
}

/** Lee una cookie por nombre (cliente). */
function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

/**
 * Devuelve _fbp y _fbc. El Pixel pone _fbp solo; _fbc lo pone a partir del
 * `fbclid` de la URL del anuncio — pero si por timing aún no existe la cookie y
 * sí hay fbclid en la URL, lo derivamos al formato que Meta espera
 * (fb.1.<timestamp>.<fbclid>) para no perder la atribución del clic del anuncio.
 */
function getFbCookies(): { fbp?: string; fbc?: string } {
  const fbp = readCookie("_fbp");
  let fbc = readCookie("_fbc");
  if (!fbc && typeof window !== "undefined") {
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
  }
  return { fbp, fbc };
}

/** event_id único (usa crypto.randomUUID si está disponible). */
function newEventId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface TrackOptions {
  /** Email del usuario (mejora el match; se hashea en el server). */
  email?: string | null;
  /** id propio del usuario (Supabase). */
  externalId?: string | null;
  /** Parámetros custom del evento (value, currency, content_name, ...). */
  customData?: Record<string, unknown>;
}

/**
 * Dispara un evento estándar de Meta por Pixel + CAPI (deduplicado).
 * No espera al server (fire-and-forget) para no retrasar la navegación.
 */
export function trackMeta(eventName: MetaEventName, opts: TrackOptions = {}): string {
  const eventId = newEventId();
  const { fbp, fbc } = getFbCookies();
  const eventSourceUrl = typeof window !== "undefined" ? window.location.href : undefined;

  // 1) Pixel del navegador (si fbq cargó; un adblocker puede impedirlo).
  if (typeof window !== "undefined" && typeof window.fbq === "function") {
    // Coincidencias avanzadas (browser-side): cuando conocemos identidad, se la
    // pasamos al Pixel vía init. El Pixel la normaliza y hashea él mismo antes de
    // enviarla; mejora el match igual que la CAPI hace server-side.
    const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
    if (pixelId && (opts.email || opts.externalId)) {
      const am: Record<string, string> = {};
      if (opts.email) am.em = opts.email.trim().toLowerCase();
      if (opts.externalId) am.external_id = opts.externalId;
      window.fbq("init", pixelId, am);
    }
    window.fbq("track", eventName, opts.customData ?? {}, { eventID: eventId });
  }

  // 2) Gemelo server-side (CAPI) con el mismo event_id. fire-and-forget.
  void trackMetaEvent({
    eventName,
    eventId,
    eventSourceUrl,
    fbp,
    fbc,
    email: opts.email ?? undefined,
    externalId: opts.externalId ?? undefined,
    customData: opts.customData,
  }).catch(() => {});

  return eventId;
}
