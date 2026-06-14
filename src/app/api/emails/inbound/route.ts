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

  // DIAGNÓSTICO TEMPORAL: con la cabecera 'x-debug-inbound: 1' devuelve por qué
  // falla la auth SIN revelar el secreto (solo longitudes y banderas). Quitar
  // después de depurar.
  if (request.headers.get("x-debug-inbound") === "1") {
    return NextResponse.json({
      envSecretSet: Boolean(process.env.EMAIL_INBOUND_SECRET),
      envLenRaw: (process.env.EMAIL_INBOUND_SECRET || "").length,
      envLenTrimmed: secret.length,
      providedLenRaw: (request.headers.get("x-inbound-secret") || "").length,
      providedLenTrimmed: provided.length,
      matchTrimmed: secret.length > 0 && secret === provided,
    });
  }

  // DIAGNÓSTICO TEMPORAL: registra CADA intento en la tabla (aunque falle la
  // auth) para ver si el worker siquiera llega aquí y con qué secreto. Quitar
  // después de depurar.
  try {
    await supabaseAdmin().from("emails").insert({
      direction: "inbound",
      from_addr: "DEBUG",
      to_addr: "DEBUG",
      subject: `attempt providedLen=${provided.length} envLen=${secret.length} match=${provided === secret}`,
      status: "debug",
      raw: { ts: new Date().toISOString(), ua: request.headers.get("user-agent") },
    });
  } catch {}

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

  const sb = supabaseAdmin();
  const { error } = await sb.from("emails").insert({
    direction: "inbound",
    from_addr: str(p.from, 320) || "desconocido",
    to_addr: str(p.to, 320) || "",
    subject: str(p.subject, 500),
    body_text: (p.text as string) ?? null,
    body_html: (p.html as string) ?? null,
    status: "received",
    provider_id: str(p.messageId, 998),
    in_reply_to: str(p.inReplyTo, 998),
    raw: p,
  });

  if (error) {
    console.error("[Email inbound] no se pudo guardar:", error.message);
    return NextResponse.json({ error: "store-failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
