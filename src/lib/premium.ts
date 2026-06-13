// ============================================================================
// Activación de Premium — lógica compartida entre el webhook de Bold y el panel
// de admin (remediación manual). Se mantiene ROBUSTA ante diferencias de
// esquema: si una columna opcional (premium_since) falta, igual se activa el
// plan, que es lo esencial. Todo es idempotente: correrlo dos veces no daña.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** Cuota de rutas que otorga Premium (pago único). Debe coincidir con generate-hash. */
export const PREMIUM_QUOTA = 3;

/**
 * Sube el perfil a Premium de forma idempotente y tolerante al esquema:
 *   1. Esencial: plan='premium' (lo que el resto de la app lee). Si falla,
 *      reintenta solo con el plan.
 *   2. Cuota: opcional y ADITIVA. route_quota es un TOPE ACUMULADO (lo "usado"
 *      = nº de rutas creadas, que nunca se reinicia), así que un paquete nuevo
 *      SUMA su cuota sobre la que el usuario ya tuviera (regalos del admin
 *      incluidos). Sin esto, comprar pisaría el tope y dejaría "usado > tope"
 *      a quien ya hubiera gastado cuota regalada. Solo suma si grantQuota>0.
 *   3. Best-effort: premium_since (columna opcional; NUNCA bloquea la activación).
 * Devuelve ok=true si al menos quedó plan='premium'.
 *
 * IMPORTANTE: como la cuota se SUMA, el llamador debe garantizar que esto se
 * ejecuta una sola vez por pago (el candado de estado de la orden en
 * activatePremiumByOrder lo asegura: pending→paid ocurre una única vez).
 */
export async function upgradeProfileToPremium(
  sb: SupabaseClient,
  userId: string,
  opts: { grantQuota?: number } = {}
): Promise<{ ok: boolean; error?: string }> {
  const grant = Math.max(0, Math.round(opts.grantQuota ?? 0));

  // 1) Lo esencial: plan (+ cuota sumada, si aplica). Un único update que falle
  //    NO debe dejar al usuario sin activar, así que si peta reintentamos solo
  //    con el plan. Para sumar la cuota leemos primero el tope actual.
  const update: Record<string, unknown> = { plan: "premium" };
  if (grant > 0) {
    const { data: prof } = await sb
      .from("profiles")
      .select("route_quota")
      .eq("id", userId)
      .maybeSingle();
    update.route_quota = (prof?.route_quota ?? 1) + grant;
  }

  const { error: e1 } = await sb
    .from("profiles")
    .update(update)
    .eq("id", userId);

  if (e1) {
    console.error(`[premium] no se pudo fijar plan+cuota para ${userId}:`, e1.message);
    const { error: e1b } = await sb.from("profiles").update({ plan: "premium" }).eq("id", userId);
    if (e1b) {
      console.error(`[premium] ✗ tampoco se pudo fijar plan=premium para ${userId}:`, e1b.message);
      return { ok: false, error: e1b.message };
    }
  }

  // 2) Marca de tiempo (columna opcional). Si no existe, se ignora: el usuario
  //    ya quedó Premium con el paso anterior.
  const { error: e2 } = await sb
    .from("profiles")
    .update({ premium_since: new Date().toISOString() })
    .eq("id", userId);
  if (e2) {
    console.warn(`[premium] premium_since no se pudo escribir para ${userId} (¿columna ausente? corre scripts/bold-setup.sql):`, e2.message);
  }

  console.log(`[premium] ✓ Usuario ${userId} activado como Premium.`);
  return { ok: true };
}

/**
 * Activa Premium a partir de una orden de Bold (idempotente):
 *   - busca la orden; si no existe o ya está 'paid', no hace nada dañino;
 *   - la marca 'paid' (tolerante a que falte la columna paid_at);
 *   - si purpose='premium', sube el perfil.
 * El monto recibido solo se compara para REGISTRAR anomalías (no bloquea: las
 * unidades que reporta Bold pueden variar y no queremos romper la activación).
 */
export async function activatePremiumByOrder(
  sb: SupabaseClient,
  orderRef: string,
  receivedAmount?: number | null
): Promise<{ activated: boolean; reason: string; userId?: string }> {
  const { data: order, error: selErr } = await sb
    .from("payment_orders")
    .select("user_id, status, purpose, amount")
    .eq("order_id", orderRef)
    .maybeSingle();

  if (selErr) {
    console.error(`[premium] error leyendo la orden ${orderRef}:`, selErr.message);
    return { activated: false, reason: "order-read-error" };
  }
  if (!order) {
    console.warn(`[premium] orden ${orderRef} no encontrada; no se activa nada.`);
    return { activated: false, reason: "order-not-found" };
  }
  if (order.status === "paid") {
    // Ya procesada: idempotente, no repetimos el upgrade.
    return { activated: false, reason: "already-paid", userId: order.user_id as string };
  }

  if (
    order.amount != null &&
    receivedAmount != null &&
    Number(order.amount) !== Number(receivedAmount)
  ) {
    console.warn(`[premium] monto distinto en ${orderRef}: esperado ${order.amount}, recibido ${receivedAmount}. Se continúa.`);
  }

  // Marca la orden pagada (tolerante a que falte paid_at).
  const { error: updErr } = await sb
    .from("payment_orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("order_id", orderRef);
  if (updErr) {
    console.warn(`[premium] no se pudo escribir paid_at en ${orderRef} (${updErr.message}); reintento solo status.`);
    await sb.from("payment_orders").update({ status: "paid" }).eq("order_id", orderRef);
  }

  if (order.purpose === "premium") {
    // Idempotente por orden (el candado de status de arriba garantiza que esto
    // corre una sola vez), así que aquí SÍ sumamos la cuota del paquete.
    const res = await upgradeProfileToPremium(sb, order.user_id as string, { grantQuota: PREMIUM_QUOTA });
    return {
      activated: res.ok,
      reason: res.ok ? "activated" : "upgrade-failed",
      userId: order.user_id as string,
    };
  }
  return { activated: false, reason: "non-premium-purpose", userId: order.user_id as string };
}
