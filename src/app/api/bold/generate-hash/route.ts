import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";

// Precios del plan Premium (pago único). Bold exige montos sin decimales.
// Bold procesa siempre en COP según la TRM; con USD el cliente solo ve el precio en dólares.
const PRICING = {
  CO: { amount: 23900, currency: "COP" }, // En Colombia
  INTL: { amount: 7, currency: "USD" }, // Fuera de Colombia (USD 7)
} as const;
type Region = keyof typeof PRICING;

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

    const { token, region } = await request.json();
    const user = await getUserFromToken(token);
    if (!user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    // Región de pago: "CO" (COP) o "INTL" (USD). Default CO por retrocompatibilidad.
    const selected: Region = region === "INTL" ? "INTL" : "CO";
    const { amount, currency } = PRICING[selected];

    const orderId = `LF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Registrar la orden como pendiente (el webhook la marcará pagada)
    const sb = supabaseAdmin();
    const { error: insErr } = await sb.from("payment_orders").insert({
      order_id: orderId,
      user_id: user.id,
      amount,
      currency,
      purpose: "premium",
      status: "pending",
    });
    if (insErr) {
      console.error("[Bold] Error creando orden:", insErr.message);
      return NextResponse.json({ error: "No se pudo crear la orden." }, { status: 500 });
    }

    const dataToHash = `${orderId}${amount}${currency}${secretKey}`;
    const integritySignature = crypto.createHash("sha256").update(dataToHash).digest("hex");

    return NextResponse.json({
      orderId,
      amount,
      currency,
      apiKey,
      integritySignature,
    });
  } catch (e) {
    console.error("[Bold] generate-hash error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
