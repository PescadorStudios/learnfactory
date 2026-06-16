import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ============================================================================
// WEBHOOK DE CORREO ENTRANTE
// ----------------------------------------------------------------------------
// Tu Email Worker de Cloudflare (ver instrucciones) parsea cada correo que
// llega a tu dominio y hace POST aquí con JSON:
//   { from, to, subject, text, html, messageId, inReplyTo }
// y la cabecera   x-inbound-secret: <EMAIL_INBOUND_SECRET>
//
// Guardamos una fila 'inbound' en public.emails para que /admin → Correos la
// muestre. Si falta la tabla, corre scripts/emails-setup.sql en Supabase.
// ============================================================================

export const dynamic = "force-dynamic"; // un webhook nunca se cachea

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  // Recortamos espacios/saltos a ambos lados: un secreto pegado con un "\n"
  // invisible (típico en paneles) no debe romper la autenticación.
  const secret = (process.env.EMAIL_INBOUND_SECRET || "").trim();
  const provided = (request.headers.get("x-inbound-secret") || "").trim();

  // Sin secreto configurado, o secreto que no coincide → rechazamos.
  if (!secret || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let p: Record<string, unknown>;
  try {
    p = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const str = (v: unknown, max: number): string | null =>
    v == null ? null : String(v).slice(0, max);

  const fromRaw = str(p.from, 320) || "desconocido";
  const subject = str(p.subject, 500);
  const bodyText = (p.text as string) ?? null;
  const bodyHtml = (p.html as string) ?? null;

  const sb = supabaseAdmin();
  const { error } = await sb.from("emails").insert({
    direction: "inbound",
    from_addr: fromRaw,
    to_addr: str(p.to, 320) || "",
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    status: "received",
    provider_id: str(p.messageId, 998),
    in_reply_to: str(p.inReplyTo, 998),
    raw: p,
  });

  if (error) {
    console.error("[Email inbound] no se pudo guardar:", error.message);
    return NextResponse.json({ error: "store-failed" }, { status: 500 });
  }

  // CRM: si el remitente coincide con un creador, marcamos 'respondio'.
  // No bloquea la respuesta del webhook si la tabla aún no existe.
  try {
    await matchCreatorReply(fromRaw, subject, bodyText, bodyHtml);
  } catch (e) {
    console.error("[Email inbound] match creador falló:", (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}

/** Extrae el email puro de un "Nombre <email@x.com>" o de un email a secas. */
function extractEmail(raw: string): string | null {
  const m = raw.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate) ? candidate : null;
}

// Empareja el correo entrante con un creador (primario: dirección del remitente;
// respaldo: token [ref:<id>] en el asunto). Setea reply_received_at, reply_snippet,
// status 'respondio' y registra un creator_touch (email/in). El estado automático
// es solo una señal: el admin lo confirma o corrige a mano desde el panel.
async function matchCreatorReply(
  fromRaw: string,
  subject: string | null,
  bodyText: string | null,
  bodyHtml: string | null
): Promise<void> {
  const sb = supabaseAdmin();

  let creatorId: string | null = null;

  // 1) Por dirección del remitente.
  const email = extractEmail(fromRaw);
  if (email) {
    const { data } = await sb.from("creators").select("id").ilike("email", email).limit(1).maybeSingle();
    if (data) creatorId = data.id as string;
  }
  // 2) Respaldo: token [ref:<id>] en el asunto.
  if (!creatorId && subject) {
    const refMatch = subject.match(/\[ref:([^\]]+)\]/i);
    if (refMatch) {
      const { data } = await sb.from("creators").select("id").eq("id", refMatch[1].trim()).maybeSingle();
      if (data) creatorId = data.id as string;
    }
  }
  if (!creatorId) return;

  const snippetBase =
    (bodyText && bodyText.trim()) ||
    (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");
  const snippet = snippetBase.slice(0, 200);

  // No degradamos estados ya cerrados manualmente (ganado/interesado/rechazado).
  const { data: cur } = await sb.from("creators").select("status").eq("id", creatorId).single();
  const keep = ["respondio", "interesado", "ganado", "rechazado"];
  const nextStatus = keep.includes(cur?.status as string) ? (cur!.status as string) : "respondio";

  await sb.from("creators").update({
    reply_received_at: new Date().toISOString(),
    reply_snippet: snippet,
    status: nextStatus,
    updated_at: new Date().toISOString(),
  }).eq("id", creatorId);

  await sb.from("creator_touches").insert({
    creator_id: creatorId, channel: "email", direction: "in", note: snippet || "Respuesta recibida",
  });
}
