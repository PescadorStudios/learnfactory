import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { effectiveEstado } from "@/lib/retoLogic";
import type { RetoEstado } from "@/lib/types";
import { MEMBERSHIP, regionFrom } from "@/lib/pricing";

/**
 * Crea una orden de pago (Premium o entrada a un reto) y devuelve la firma de
 * integridad de Bold. Hash = SHA256(orderId + amount + currency + secretKey)
 * en hex (idéntico al patrón del proyecto del casco).
 *
 * purpose='reto': el monto/moneda los fija el reto (precio_entrada), la orden
 * lleva reto_id y `meta` arrastra consentimiento/alias del formulario de
 * inscripción hasta que el webhook confirma y crea al participante.
 */
export async function POST(request: Request) {
  try {
    const secretKey = process.env.BOLD_SECRET_KEY;
    const apiKey = process.env.BOLD_API_KEY;
    if (!secretKey || !apiKey) {
      return NextResponse.json({ error: "Bold no está configurado (faltan llaves)." }, { status: 500 });
    }

    const { token, region, purpose, retoId, meta } = await request.json();
    const user = await getUserFromToken(token);
    if (!user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const sb = supabaseAdmin();

    let amount: number;
    let currency: string;
    let orderId: string;
    let orderPurpose: string;
    let orderRetoId: string | null = null;
    let orderMeta: Record<string, unknown> | null = null;

    if (purpose === "reto") {
      // ── Entrada a un reto: precio y moneda fijos del reto ──
      const { data: reto } = await sb
        .from("retos")
        .select("id, creador_id, precio_entrada, moneda, estado, fecha_inicio, fecha_fin")
        .eq("id", retoId)
        .maybeSingle();
      if (!reto) return NextResponse.json({ error: "Reto no encontrado." }, { status: 404 });
      if (reto.creador_id === user.id) {
        return NextResponse.json({ error: "No puedes pagar tu propio reto." }, { status: 400 });
      }
      const estado = effectiveEstado({
        estado: reto.estado as RetoEstado,
        fechaInicio: reto.fecha_inicio,
        fechaFin: reto.fecha_fin,
      });
      if (estado !== "publicado" && estado !== "en_curso") {
        return NextResponse.json({ error: "Este reto no está aceptando inscripciones." }, { status: 400 });
      }
      if (!reto.precio_entrada || reto.precio_entrada <= 0) {
        return NextResponse.json({ error: "Este reto es gratuito: inscríbete sin pago." }, { status: 400 });
      }
      const { data: ya } = await sb
        .from("reto_participantes")
        .select("id")
        .eq("reto_id", reto.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (ya) return NextResponse.json({ error: "Ya estás inscrito en este reto." }, { status: 400 });

      amount = Math.round(Number(reto.precio_entrada));
      currency = reto.moneda === "USD" ? "USD" : "COP";
      orderId = `LF-RETO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      orderPurpose = "reto";
      orderRetoId = reto.id as string;
      const m = (meta ?? {}) as { consentContacto?: boolean; alias?: string; anonimo?: boolean };
      orderMeta = {
        consentContacto: Boolean(m.consentContacto),
        alias: typeof m.alias === "string" ? m.alias.trim().slice(0, 40) : null,
        anonimo: Boolean(m.anonimo),
      };
    } else {
      // ── Membresía (flujo original de Premium) ──
      // Región de pago: "CO" (COP) o "INTL" (USD). Default CO por retrocompatibilidad.
      // El precio es UNA sola fuente de verdad: src/lib/pricing.ts.
      const price = MEMBERSHIP[regionFrom(region)];
      amount = price.amount;
      currency = price.currency;
      orderId = `LF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // 'membresia' es el propósito nuevo (mensual). El webhook sigue aceptando
      // 'premium' para no romper órdenes pendientes creadas antes de este cambio.
      orderPurpose = "membresia";
    }

    // Registrar la orden como pendiente (el webhook la marcará pagada)
    const { error: insErr } = await sb.from("payment_orders").insert({
      order_id: orderId,
      user_id: user.id,
      amount,
      currency,
      purpose: orderPurpose,
      status: "pending",
      ...(orderRetoId ? { reto_id: orderRetoId, meta: orderMeta } : {}),
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
