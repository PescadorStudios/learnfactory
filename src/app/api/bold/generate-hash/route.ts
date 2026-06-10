import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";

// Precio del plan Premium (pago único). Pesos colombianos, sin decimales.
const PREMIUM_AMOUNT = 23900;
const CURRENCY = "COP";

/**
 * Crea una orden de pago Premium y devuelve la firma de integridad de Bold.
 * Hash = SHA256(orderId + amount + currency + secretKey) en hex (idéntico al
 * patrón del proyecto del casco).
 */
export async function POST(request: Request) {
  try {
    const secretKey = process.env.BOLD_SECRET_KEY;
    const apiKey = process.env.BOLD_API_KEY;
    if (!secretKey || !apiKey) {
      return NextResponse.json({ error: "Bold no está configurado (faltan llaves)." }, { status: 500 });
    }

    const { token } = await request.json();
    const user = await getUserFromToken(token);
    if (!user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const orderId = `LF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const amount = PREMIUM_AMOUNT;

    // Registrar la orden como pendiente (el webhook la marcará pagada)
    const sb = supabaseAdmin();
    const { error: insErr } = await sb.from("payment_orders").insert({
      order_id: orderId,
      user_id: user.id,
      amount,
      currency: CURRENCY,
      purpose: "premium",
      status: "pending",
    });
    if (insErr) {
      console.error("[Bold] Error creando orden:", insErr.message);
      return NextResponse.json({ error: "No se pudo crear la orden." }, { status: 500 });
    }

    const dataToHash = `${orderId}${amount}${CURRENCY}${secretKey}`;
    const integritySignature = crypto.createHash("sha256").update(dataToHash).digest("hex");

    return NextResponse.json({
      orderId,
      amount,
      currency: CURRENCY,
      apiKey,
      integritySignature,
    });
  } catch (e) {
    console.error("[Bold] generate-hash error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
