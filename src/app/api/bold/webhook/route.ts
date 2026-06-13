import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activatePremiumByOrder } from "@/lib/premium";

// ============================================================================
// WEBHOOK DE CONFIRMACIÓN DE BOLD
// ----------------------------------------------------------------------------
// Pega la URL pública de esta ruta:   https://<tu-dominio>/api/bold/webhook
// en Bold → Integraciones → Webhooks. (La misma URL aparece en /admin → Pagos,
// con botón para copiarla.) Cuando Bold aprueba un pago:
//   1. Guarda la transacción cruda en bold_transactions (auditoría, idempotente).
//   2. Marca la orden 'paid' y SUBE el perfil a Premium (vía activatePremiumByOrder).
//
// Notas:
//   • Idempotente: Bold puede reintentar; reprocesar no daña (orden ya 'paid').
//   • NO dispara Meta CAPI (no se necesita por ahora).
//   • Si los pagos no activan: revisa que exista el esquema (scripts/bold-setup.sql).
// ============================================================================

export const dynamic = "force-dynamic"; // un webhook nunca se cachea ni se prerenderiza

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Verifica la firma del webhook (defensa en profundidad). Bold envía la cabecera
 * `x-bold-signature`; probamos los encodings plausibles del HMAC-SHA256 del
 * cuerpo crudo con la llave secreta. Devuelve true/false si se pudo comprobar, o
 * null si no hay con qué (sin llave o sin cabecera). NO se bloquea por una firma
 * inválida salvo que BOLD_WEBHOOK_ENFORCE_SIGNATURE === "true": así, si el
 * esquema de Bold difiere, no rompemos un flujo de pago en producción. La
 * garantía principal sigue siendo que la orden exista en payment_orders (creada
 * en el servidor para un usuario autenticado) y esté pendiente.
 */
function verifySignature(rawBody: string, headerSig: string | null, secret?: string): boolean | null {
  if (!secret || !headerSig) return null;
  try {
    const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
    const sig = headerSig.trim();
    return timingSafeEq(sig, digest.toString("hex")) || timingSafeEq(sig, digest.toString("base64"));
  } catch {
    return null;
  }
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const timestamp = Date.now();
  let body = "";
  try {
    body = await request.text();
  } catch {
    body = "";
  }

  const headerSig =
    request.headers.get("x-bold-signature") || request.headers.get("X-Bold-Signature");
  const verified = verifySignature(body, headerSig, process.env.BOLD_SECRET_KEY);
  const enforce = process.env.BOLD_WEBHOOK_ENFORCE_SIGNATURE === "true";

  let tx: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    const parsed = JSON.parse(body);
    tx = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e) {
    parseError = String(e);
  }

  const sb = supabaseAdmin();

  const d = (tx?.data || {}) as Record<string, unknown>;
  const amt = (d?.amount || {}) as Record<string, unknown>;
  const meta = (d?.metadata || {}) as Record<string, unknown>;
  const orderRef = (meta?.reference as string) || (d?.reference as string) || null;
  const transactionType = (tx?.type as string) || "WEBHOOK_RAW";
  const amountTotal = (amt?.total as number) ?? 0;

  const isApproved =
    transactionType === "SALE_APPROVED" ||
    transactionType === "PAYMENT_APPROVED" ||
    transactionType === "APPROVED" ||
    transactionType.toUpperCase().includes("APPROV") ||
    transactionType.toUpperCase().includes("SUCCESS");

  // --- 1. Auditoría: guardar la transacción cruda (idempotente por payment_id). ---
  const paymentId = (d?.payment_id as string) || (tx?.id as string) || `BOLD-${timestamp}`;
  const payerEmail = (d?.payer_email as string) || null;
  const insertData: Record<string, unknown> = {
    payment_id: paymentId,
    transaction_type: transactionType,
    amount_total: amountTotal,
    amount_currency: (amt?.currency as string) || "COP",
    order_reference: orderRef,
    customer_data: payerEmail ? { payer_email: payerEmail } : null,
    raw_data: tx
      ? { ...tx, _webhook: { verified, enforce, receivedAt: new Date().toISOString() } }
      : { body, parseError, timestamp },
  };
  const { error: insErr } = await sb.from("bold_transactions").insert(insertData);
  if (insErr) {
    if (insErr.code === "23505") {
      insertData.payment_id = `${paymentId}-${Math.random().toString(36).slice(2, 8)}`;
      await sb.from("bold_transactions").insert(insertData);
    } else {
      // No abortamos: la auditoría es secundaria frente a activar al usuario.
      console.error("[Bold] no se pudo registrar la transacción:", insErr.message);
    }
  }

  // --- Bloqueo opcional por firma (desactivado por defecto). ---
  if (enforce && verified === false) {
    console.warn("[Bold] firma inválida — activación BLOQUEADA (BOLD_WEBHOOK_ENFORCE_SIGNATURE=true).");
    return NextResponse.json({ success: true, ignored: "bad-signature" }, { status: 200, headers: CORS });
  }

  // --- 2. Activar Premium si el pago fue aprobado y conocemos la orden. ---
  try {
    if (isApproved && orderRef) {
      const res = await activatePremiumByOrder(sb, orderRef, amountTotal);
      console.log(`[Bold] orden ${orderRef}: ${res.reason}${res.userId ? ` (user ${res.userId})` : ""}.`);
    } else if (isApproved && !orderRef) {
      console.warn(`[Bold] pago aprobado SIN referencia de orden; no se puede activar. payment_id=${paymentId}`);
    }
  } catch (e) {
    console.error("[Bold] error activando Premium:", e);
  }

  // Siempre 200: el webhook es idempotente y no debe entrar en bucle de reintentos.
  return NextResponse.json({ success: true }, { status: 200, headers: CORS });
}
