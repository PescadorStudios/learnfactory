"use server";

// Server action que el cliente llama para emitir un evento por la Conversions
// API (CAPI). El navegador YA disparó el Pixel con el mismo `eventId`; aquí
// añadimos los datos que solo el server conoce (IP, User-Agent) y mandamos el
// gemelo server-side. Meta deduplica por `eventId`.

import { headers } from "next/headers";
import { sendMetaCapiEvent, type MetaEventName } from "@/lib/meta/capi";

const ALLOWED_EVENTS: readonly MetaEventName[] = [
  "Lead",
  "CompleteRegistration",
  "ViewContent",
];

export interface TrackMetaInput {
  eventName: MetaEventName;
  /** Mismo id que disparó el Pixel del navegador (deduplicación). */
  eventId: string;
  eventSourceUrl?: string;
  /** Cookies de Meta leídas en el cliente (document.cookie). */
  fbp?: string;
  fbc?: string;
  /** Email del usuario (se hashea server-side; mejora el match). */
  email?: string;
  /** id propio del usuario (Supabase), si lo hay. */
  externalId?: string;
  customData?: Record<string, unknown>;
}

/** IP del cliente a partir de los headers (Vercel pone x-forwarded-for). */
function clientIpFrom(h: { get(name: string): string | null }): string | null {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

export async function trackMetaEvent(input: TrackMetaInput): Promise<{ ok: boolean }> {
  if (!input?.eventId || !ALLOWED_EVENTS.includes(input.eventName)) {
    return { ok: false };
  }

  const h = await headers();
  await sendMetaCapiEvent({
    eventName: input.eventName,
    eventId: input.eventId,
    eventSourceUrl: input.eventSourceUrl || h.get("referer"),
    userData: {
      email: input.email,
      externalId: input.externalId,
      fbp: input.fbp,
      fbc: input.fbc,
      ip: clientIpFrom(h),
      userAgent: h.get("user-agent"),
    },
    customData: input.customData,
  });

  return { ok: true };
}
