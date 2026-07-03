// ============================================================================
// Academia de Retos — orquestación con DB (SOLO servidor).
// ----------------------------------------------------------------------------
// Tres responsabilidades, todas idempotentes:
//   1. evaluateRetoCompletion: hook post-intento — detecta el 100% verificado,
//      fija el timestamp INMUTABLE de finalización y asigna premios.
//   2. fulfillRetoOrder: el webhook de Bold confirmó un pago de reto — crea al
//      participante, acredita el 80/20 en la wallet y vincula la ruta.
//   3. finalizeRetoIfDueCore: cierre perezoso al vencer fecha_fin + correo de
//      anuncio de ganadores (una sola vez).
// La lógica pura (ranking, verificación, split) vive en retoLogic.ts.
// ============================================================================
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail, htmlFromText } from "@/lib/email/resend";
import { getBaseUrl } from "@/lib/routeJobs";
import {
  isVerifiedComplete,
  rankFinishers,
  assignPrizes,
  splitPago,
  effectiveEstado,
  type Finisher,
  type RetoLessonInfo,
  type RetoAttemptInfo,
} from "@/lib/retoLogic";
import type { RetoEstado } from "@/lib/types";

interface RetoRow {
  id: string;
  titulo: string;
  creador_id: string;
  ruta_id: string;
  estado: RetoEstado;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  moneda: string;
  winners_notificados_at: string | null;
}

const RETO_COLS = "id, titulo, creador_id, ruta_id, estado, fecha_inicio, fecha_fin, moneda, winners_notificados_at";

/** Lecciones de una ruta reducidas a lo que la verificación necesita. */
export async function loadRetoLessons(sb: SupabaseClient, routeId: string): Promise<RetoLessonInfo[]> {
  const { data: lessons } = await sb
    .from("lessons")
    .select("node_id, audio_questions")
    .eq("route_id", routeId);
  return (lessons || []).map(l => ({
    nodeId: l.node_id as string,
    hasAttention:
      !!l.audio_questions &&
      !Array.isArray(l.audio_questions) &&
      typeof l.audio_questions === "object" &&
      "mode" in (l.audio_questions as Record<string, unknown>),
  }));
}

/** Intentos aprobados de un usuario en una ruta, con su detalle de atención. */
export async function loadRetoAttempts(
  sb: SupabaseClient,
  userId: string,
  routeId: string
): Promise<RetoAttemptInfo[]> {
  const { data: attempts } = await sb
    .from("attempts")
    .select("node_id, passed, detail")
    .eq("route_id", routeId)
    .eq("user_id", userId)
    .eq("passed", true);
  return (attempts || []).map(a => ({
    nodeId: a.node_id as string,
    passed: true,
    attention: (a.detail as { attention?: { correct: number; total: number } } | null)?.attention ?? null,
  }));
}

/**
 * Hook post-intento (lo llama saveAttempt cuando el usuario aprueba un nodo
 * nuevo). Si la ruta pertenece a un reto y este usuario acaba de completar el
 * 100% verificado, registra la finalización y asigna premios. Para rutas sin
 * reto cuesta UNA query indexada y retorna.
 */
export async function evaluateRetoCompletion(userId: string, routeId: string): Promise<void> {
  const sb = supabaseAdmin();

  const { data: reto } = await sb.from("retos").select(RETO_COLS).eq("ruta_id", routeId).maybeSingle();
  if (!reto) return;
  const r = reto as RetoRow;

  const { data: part } = await sb
    .from("reto_participantes")
    .select("id, finalizacion_verificada_at")
    .eq("reto_id", r.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!part || part.finalizacion_verificada_at) return;

  // Tras fecha_fin el reto ya no compite (el participante conserva la ruta).
  const estado = effectiveEstado({
    estado: r.estado,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
  });
  if (estado !== "publicado" && estado !== "en_curso") return;

  const [lessons, attempts] = await Promise.all([
    loadRetoLessons(sb, routeId),
    loadRetoAttempts(sb, userId, routeId),
  ]);
  const result = isVerifiedComplete(lessons, attempts);
  if (!result.complete) return;

  // Timestamp inmutable: el `where finalizacion is null` + trigger de DB
  // garantizan que solo se fija una vez, con el instante del intento decisivo.
  const { data: updated } = await sb
    .from("reto_participantes")
    .update({
      finalizacion_verificada_at: new Date().toISOString(),
      atencion_score: Math.round(result.attentionScore * 1000) / 1000,
    })
    .eq("id", part.id)
    .is("finalizacion_verificada_at", null)
    .select("id");
  if (!updated?.length) return; // otra request llegó primero: nada que hacer

  console.log(`[Reto] finalización verificada registrada: reto=${r.id} user=${userId}`);
  await assignRetoPrizes(sb, r, userId);
}

/**
 * Recomputa la asignación de premios de forma determinista y escribe SOLO las
 * posiciones nuevas (null → valor). Los premios ya asignados nunca se revocan;
 * el índice único (reto_id, premio_posicion) protege de carreras.
 */
async function assignRetoPrizes(sb: SupabaseClient, reto: RetoRow, justFinishedUserId?: string): Promise<void> {
  const { data: premios } = await sb
    .from("reto_premios")
    .select("posicion, titulo")
    .eq("reto_id", reto.id)
    .order("posicion");
  if (!premios?.length) return;

  const { data: rows } = await sb
    .from("reto_participantes")
    .select("id, user_id, finalizacion_verificada_at, atencion_score, inscrito_at, premio_posicion")
    .eq("reto_id", reto.id)
    .not("finalizacion_verificada_at", "is", null);
  if (!rows?.length) return;

  const finishers: Finisher[] = rows.map(row => ({
    userId: row.user_id as string,
    finishedAt: row.finalizacion_verificada_at as string,
    attentionScore: Number(row.atencion_score ?? 0),
    enrolledAt: row.inscrito_at as string,
  }));
  const wanted = assignPrizes(rankFinishers(finishers), premios.length);

  for (const row of rows) {
    const pos = wanted.get(row.user_id as string);
    if (!pos || row.premio_posicion != null) continue;
    const { error } = await sb
      .from("reto_participantes")
      .update({ premio_posicion: pos })
      .eq("id", row.id)
      .is("premio_posicion", null);
    if (error) {
      // 23505 = otra request asignó esa posición en paralelo; el recomputo
      // determinista de la próxima finalización lo corrige solo.
      console.warn(`[Reto] no se pudo asignar premio pos=${pos} en reto=${reto.id}:`, error.message);
      continue;
    }
    console.log(`[Reto] premio asignado: reto=${reto.id} user=${row.user_id} posicion=${pos}`);
    if (row.user_id === justFinishedUserId) {
      const titulo = premios.find(p => p.posicion === pos)?.titulo ?? `Premio ${pos}`;
      await notifyWinner(sb, reto, row.user_id as string, pos, titulo);
    }
  }
}

/** Correo al ganador (con su premio) y aviso al creador. Best-effort. */
async function notifyWinner(
  sb: SupabaseClient,
  reto: RetoRow,
  userId: string,
  posicion: number,
  premioTitulo: string
): Promise<void> {
  const { data: profs } = await sb
    .from("profiles")
    .select("id, email, display_name, username")
    .in("id", [userId, reto.creador_id]);
  const winner = profs?.find(p => p.id === userId);
  const creator = profs?.find(p => p.id === reto.creador_id);
  const url = `${getBaseUrl()}/reto/${reto.id}`;

  if (winner?.email) {
    const nombre = winner.display_name || winner.username || "explorador";
    await sendEmail({
      to: winner.email,
      subject: `🏆 ¡Ganaste el premio ${posicion} del reto "${reto.titulo}"!`,
      html: htmlFromText(
        `¡Felicitaciones, ${nombre}!\n\n` +
          `Completaste el 100% del reto "${reto.titulo}" con verificación de atención y ` +
          `te llevaste el premio de la posición ${posicion}:\n\n` +
          `🏆 ${premioTitulo}\n\n` +
          `El creador del reto se pondrá en contacto contigo para entregártelo.\n` +
          `Y recuerda: la ruta es tuya para siempre.\n\n${url}`
      ),
    });
  }
  if (creator?.email) {
    await sendEmail({
      to: creator.email,
      subject: `Tu reto "${reto.titulo}" tiene un nuevo ganador (posición ${posicion})`,
      html: htmlFromText(
        `${winner?.display_name || winner?.username || "Un participante"} completó el 100% ` +
          `de tu reto con verificación de atención y ganó el premio de la posición ${posicion} ` +
          `(${premioTitulo}).\n\nRevisa el dashboard para coordinar la entrega:\n${getBaseUrl()}/retos/${reto.id}`
      ),
    });
  }
}

// ──────────────────────────────────────────────────
//  Fulfillment del pago (webhook de Bold)
// ──────────────────────────────────────────────────

/**
 * Completa una orden de reto ya marcada 'paid' por el webhook: participante +
 * wallet 80/20 + vínculo permanente de la ruta + correo de bienvenida.
 * No-op para órdenes que no sean purpose='reto'. Reintentos del webhook son
 * inocuos: unique(reto_id,user_id) y unique(order_id) absorben duplicados.
 */
export async function fulfillRetoOrder(sb: SupabaseClient, orderRef: string): Promise<void> {
  const { data: order } = await sb
    .from("payment_orders")
    .select("order_id, user_id, amount, currency, purpose, status, reto_id, meta")
    .eq("order_id", orderRef)
    .maybeSingle();
  if (!order || order.purpose !== "reto" || order.status !== "paid" || !order.reto_id) return;

  const { data: reto } = await sb.from("retos").select(RETO_COLS).eq("id", order.reto_id).maybeSingle();
  if (!reto) {
    console.warn(`[Reto] orden ${orderRef} apunta a un reto inexistente (${order.reto_id}).`);
    return;
  }
  const r = reto as RetoRow;
  const meta = (order.meta ?? {}) as { consentContacto?: boolean; alias?: string; anonimo?: boolean };

  // 1) Participante (idempotente por unique(reto_id, user_id)).
  let participanteId: string | null = null;
  const { data: existing } = await sb
    .from("reto_participantes")
    .select("id")
    .eq("reto_id", r.id)
    .eq("user_id", order.user_id)
    .maybeSingle();
  if (existing) {
    participanteId = existing.id as string;
  } else {
    const { data: inserted, error } = await sb
      .from("reto_participantes")
      .insert({
        reto_id: r.id,
        user_id: order.user_id,
        via: "pago",
        order_id: order.order_id,
        consent_contacto: Boolean(meta.consentContacto),
        alias: typeof meta.alias === "string" && meta.alias.trim() ? meta.alias.trim().slice(0, 40) : null,
        anonimo: Boolean(meta.anonimo),
      })
      .select("id")
      .maybeSingle();
    if (error && error.code !== "23505") {
      console.error(`[Reto] no se pudo inscribir al participante de ${orderRef}:`, error.message);
      return;
    }
    participanteId = inserted?.id ?? null;
    console.log(`[Reto] participante inscrito por pago: reto=${r.id} user=${order.user_id}`);
  }

  // 2) Wallet 80/20 (idempotente por unique(order_id)).
  const amount = Number(order.amount) || 0;
  if (amount > 0) {
    const { creador, plataforma } = splitPago(amount);
    const { error: wErr } = await sb.from("wallet_movimientos").insert({
      creador_id: r.creador_id,
      reto_id: r.id,
      participante_id: participanteId,
      order_id: order.order_id,
      monto_bruto: amount,
      monto_creador: creador,
      monto_plataforma: plataforma,
      moneda: order.currency || r.moneda,
      estado: "disponible",
    });
    if (wErr && wErr.code !== "23505") {
      console.error(`[Reto] no se pudo acreditar la wallet para ${orderRef}:`, wErr.message);
    }
  }

  // 3) Vínculo permanente con la ruta (biblioteca del participante).
  await sb
    .from("route_starts")
    .upsert({ user_id: order.user_id, route_id: r.ruta_id }, { onConflict: "user_id,route_id", ignoreDuplicates: true });

  // 4) Bienvenida (best-effort).
  const { data: prof } = await sb.from("profiles").select("email, display_name, username").eq("id", order.user_id).maybeSingle();
  if (prof?.email) {
    await sendEmail({
      to: prof.email,
      subject: `Estás dentro: reto "${r.titulo}"`,
      html: htmlFromText(
        `¡Bienvenido al reto, ${prof.display_name || prof.username || "explorador"}!\n\n` +
          `Tu inscripción está confirmada. La ruta ya está vinculada a tu cuenta — es tuya ` +
          `para siempre, termine como termine el reto.\n\n` +
          `Los primeros en completar el 100% de la ruta con verificación de atención ganan ` +
          `los premios. Empieza ya:\n\n${getBaseUrl()}/reto/${r.id}`
      ),
    });
  }
}

// ──────────────────────────────────────────────────
//  Cierre perezoso del reto + anuncio de ganadores
// ──────────────────────────────────────────────────

/**
 * Si el reto venció (fecha_fin pasada), lo marca 'finalizado' y envía UNA sola
 * vez el correo de anuncio de ganadores a todos los participantes (candado
 * winners_notificados_at). Se llama al cargar el dashboard o la ficha pública.
 */
export async function finalizeRetoIfDueCore(retoId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data: reto } = await sb.from("retos").select(RETO_COLS).eq("id", retoId).maybeSingle();
  if (!reto) return;
  const r = reto as RetoRow;

  if (r.estado !== "publicado" && r.estado !== "en_curso") return;
  if (!r.fecha_fin || new Date(r.fecha_fin) > new Date()) return;

  await sb.from("retos").update({ estado: "finalizado" }).eq("id", retoId).in("estado", ["publicado", "en_curso"]);

  // Candado: solo la request que logra fijar winners_notificados_at envía correos.
  const { data: locked } = await sb
    .from("retos")
    .update({ winners_notificados_at: new Date().toISOString() })
    .eq("id", retoId)
    .is("winners_notificados_at", null)
    .select("id");
  if (!locked?.length) return;

  const [{ data: parts }, { data: premios }] = await Promise.all([
    sb.from("reto_participantes").select("user_id, premio_posicion").eq("reto_id", retoId),
    sb.from("reto_premios").select("posicion, titulo").eq("reto_id", retoId),
  ]);
  if (!parts?.length) return;

  const { data: profs } = await sb
    .from("profiles")
    .select("id, email, display_name, username")
    .in("id", parts.map(p => p.user_id));
  const url = `${getBaseUrl()}/reto/${retoId}`;
  const premioDe = new Map((premios || []).map(p => [p.posicion, p.titulo]));

  for (const p of parts) {
    const prof = profs?.find(x => x.id === p.user_id);
    if (!prof?.email) continue;
    const gano = p.premio_posicion != null;
    await sendEmail({
      to: prof.email,
      subject: gano
        ? `🏆 Reto "${r.titulo}" finalizado: ¡ganaste el premio ${p.premio_posicion}!`
        : `Reto "${r.titulo}" finalizado — la ruta sigue siendo tuya`,
      html: htmlFromText(
        gano
          ? `El reto terminó y quedaste en las posiciones premiadas.\n\n` +
            `🏆 Premio ${p.premio_posicion}: ${premioDe.get(p.premio_posicion!) ?? ""}\n\n` +
            `Mira los ganadores:\n${url}`
          : `El reto "${r.titulo}" llegó a su fin. Los ganadores ya están publicados.\n\n` +
            `Lo más importante: la ruta sigue vinculada a tu cuenta para siempre — ` +
            `puedes terminarla o repasarla cuando quieras.\n\n${url}`
      ),
    });
  }
}
