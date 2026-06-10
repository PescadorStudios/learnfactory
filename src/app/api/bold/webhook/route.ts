import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Webhook de confirmación de Bold. Configurar la URL en el dashboard de Bold.
// Al aprobarse el pago, marca la orden como pagada y sube el plan del usuario a Premium.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const PREMIUM_QUOTA = 3;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const timestamp = Date.now();
  let body = "";
  try {
    body = await request.text();
  } catch {
    body = "";
  }

  let tx: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    const parsed = JSON.parse(body);
    tx = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e) {
    parseError = String(e);
  }

  const sb = supabaseAdmin();

  try {
    const d = (tx?.data || {}) as Record<string, unknown>;
    const amt = (d?.amount || {}) as Record<string, unknown>;
    const meta = (d?.metadata || {}) as Record<string, unknown>;
    const orderRef = (meta?.reference as string) || (d?.reference as string) || null;
    const transactionType = (tx?.type as string) || "WEBHOOK_RAW";

    const isApproved =
      transactionType === "SALE_APPROVED" ||
      transactionType === "PAYMENT_APPROVED" ||
      transactionType === "APPROVED" ||
      transactionType.toUpperCase().includes("APPROV");

    // Auditoría: guardar la transacción cruda (idempotente por payment_id)
    const paymentId = (d?.payment_id as string) || (tx?.id as string) || `BOLD-${timestamp}`;
    const insertData = {
      payment_id: paymentId,
      transaction_type: transactionType,
      amount_total: (amt?.total as number) ?? 0,
      amount_currency: (amt?.currency as string) || "COP",
      order_reference: orderRef,
      raw_data: tx || { body, parseError, timestamp },
      customer_data: null,
    };
    const { error: insErr } = await sb.from("bold_transactions").insert(insertData);
    if (insErr?.code === "23505") {
      insertData.payment_id = `${paymentId}-${Math.random().toString(36).slice(2, 8)}`;
      await sb.from("bold_transactions").insert(insertData);
    }

    // Subir a Premium si el pago fue aprobado y conocemos la orden
    if (isApproved && orderRef) {
      const { data: order } = await sb
        .from("payment_orders")
        .select("user_id, status, purpose")
        .eq("order_id", orderRef)
        .maybeSingle();

      if (order && order.status !== "paid") {
        await sb.from("payment_orders").update({ status: "paid" }).eq("order_id", orderRef);
        if (order.purpose === "premium") {
          await sb
            .from("profiles")
            .update({ plan: "premium", route_quota: PREMIUM_QUOTA, premium_since: new Date().toISOString() })
            .eq("id", order.user_id);
          console.log(`[Bold] ✓ Usuario ${order.user_id} ahora es Premium (orden ${orderRef}).`);
        }
      }
    }
  } catch (e) {
    console.error("[Bold] webhook error:", e);
  }

  // Siempre 200: el webhook es idempotente y no debe reintentar en bucle.
  return NextResponse.json({ success: true }, { status: 200, headers: CORS });
}
