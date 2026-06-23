import "server-only";

// ──────────────────────────────────────────────────────────────────────────
//  Meta Conversions API (CAPI)
//  Envía eventos server-to-server a Meta. Funciona en pareja con el Pixel del
//  navegador: AMBOS mandan el MISMO evento con el MISMO `event_id`, y Meta los
//  deduplica. Así no perdemos conversiones cuando el navegador bloquea el Pixel
//  (adblockers / iOS / ITP) y mejoramos el "match quality" con datos del server
//  (IP, user-agent, email hasheado).
//
//  Config (env):
//    NEXT_PUBLIC_META_PIXEL_ID   id del pixel (público; lo usa también el Pixel)
//    META_CAPI_TOKEN             token de la Conversions API (SECRETO)
//    META_TEST_EVENT_CODE        opcional: código del "Test Events" de Meta
//
//  Si falta el id o el token, todo queda como no-op silencioso (no rompe build
//  ni desarrollo local).
// ──────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";

const GRAPH_VERSION = "v21.0";

export type MetaEventName =
  | "PageView"
  | "Lead"
  | "CompleteRegistration"
  | "ViewContent";

export interface MetaUserData {
  /** Email en claro: se normaliza y hashea (SHA-256) aquí; NUNCA se envía en claro. */
  email?: string | null;
  /** id propio del usuario (Supabase): se hashea para `external_id`. */
  externalId?: string | null;
  /** Cookie _fbp del navegador. */
  fbp?: string | null;
  /** Cookie _fbc del navegador (o derivada de fbclid). */
  fbc?: string | null;
  /** IP del cliente (de los headers de la request). */
  ip?: string | null;
  /** User-Agent del cliente. */
  userAgent?: string | null;
}

export interface MetaCapiEvent {
  eventName: MetaEventName;
  /** Mismo id que dispara el Pixel del navegador → deduplicación. */
  eventId: string;
  /** URL donde ocurrió el evento (para atribución). */
  eventSourceUrl?: string | null;
  userData: MetaUserData;
  customData?: Record<string, unknown>;
}

/** SHA-256 en hex de un valor normalizado (trim + minúsculas). Vacío → undefined. */
function hashNormalized(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex");
}

/** ¿Está configurada la CAPI? (id de pixel + token presentes). */
export function isCapiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID && process.env.META_CAPI_TOKEN);
}

/**
 * Envía UN evento a la Conversions API de Meta. No lanza: si falla o no está
 * configurado, solo registra un warning (las conversiones nunca deben romper el
 * flujo del usuario).
 */
export async function sendMetaCapiEvent(event: MetaCapiEvent): Promise<void> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) return; // no-op si no está configurado

  const { userData } = event;

  // user_data: campos hasheables como array; el resto en claro (Meta lo exige así).
  const user_data: Record<string, unknown> = {};
  const em = hashNormalized(userData.email);
  if (em) user_data.em = [em];
  const externalId = hashNormalized(userData.externalId);
  if (externalId) user_data.external_id = [externalId];
  if (userData.ip) user_data.client_ip_address = userData.ip;
  if (userData.userAgent) user_data.client_user_agent = userData.userAgent;
  if (userData.fbp) user_data.fbp = userData.fbp;
  if (userData.fbc) user_data.fbc = userData.fbc;

  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: "website",
        ...(event.eventSourceUrl ? { event_source_url: event.eventSourceUrl } : {}),
        user_data,
        ...(event.customData ? { custom_data: event.customData } : {}),
      },
    ],
    ...(process.env.META_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_TEST_EVENT_CODE }
      : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        // Telemetría: no debe retener el render ni cachearse.
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[MetaCAPI] ${event.eventName} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
  } catch (e) {
    console.warn(`[MetaCAPI] ${event.eventName} falló:`, e);
  }
}
