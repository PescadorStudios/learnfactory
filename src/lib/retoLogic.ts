// ──────────────────────────────────────────────────
//  Academia de Retos — lógica de ganadores (PURA)
// ──────────────────────────────────────────────────
// Este módulo no toca la base de datos ni el servidor: son funciones puras
// para poder testearlas en aislamiento (src/lib/retoLogic.test.ts). El
// orquestador con DB vive en src/lib/retoFulfillment.ts.

import type { RetoEstado } from "./types";

/**
 * Umbral de atención por lección con audio: el mejor intento aprobado debe
 * tener correct/total >= este valor para contar como "verificado". Dejar
 * correr el audio sin jugar (attention ausente o total=0) NO cuenta.
 */
export const RETO_ATTENTION_MIN = 0.5;

/** Lección de la ruta, reducida a lo que la verificación necesita. */
export interface RetoLessonInfo {
  nodeId: string;
  /** true si la lección tiene juego de atención (lessons.audio_questions no nulo). */
  hasAttention: boolean;
}

/** Intento aprobado de un usuario, reducido a lo que la verificación necesita. */
export interface RetoAttemptInfo {
  nodeId: string;
  passed: boolean;
  attention?: { correct: number; total: number } | null;
}

export interface VerifiedResult {
  complete: boolean;
  /** % de lecciones completadas CON verificación (0-100). */
  completionPct: number;
  /** Atención global: sum(correct)/sum(total) del mejor intento por nodo (0-1). */
  attentionScore: number;
}

/**
 * ¿Completó este usuario el 100% de la ruta con verificación de atención?
 * - Toda lección necesita al menos un intento passed=true.
 * - Toda lección CON audio necesita además que su MEJOR intento aprobado (por
 *   ratio de atención) tenga total>0 y correct/total >= RETO_ATTENTION_MIN.
 * - Lecciones sin audio (p. ej. debates) solo requieren passed.
 */
export function isVerifiedComplete(
  lessons: RetoLessonInfo[],
  attempts: RetoAttemptInfo[]
): VerifiedResult {
  if (lessons.length === 0) return { complete: false, completionPct: 0, attentionScore: 0 };

  // Mejor intento aprobado por nodo (mayor ratio de atención).
  const bestByNode = new Map<string, RetoAttemptInfo>();
  for (const a of attempts) {
    if (!a.passed) continue;
    const prev = bestByNode.get(a.nodeId);
    if (!prev || attentionRatio(a) > attentionRatio(prev)) bestByNode.set(a.nodeId, a);
  }

  let done = 0;
  let sumCorrect = 0;
  let sumTotal = 0;
  for (const lesson of lessons) {
    const best = bestByNode.get(lesson.nodeId);
    if (!best) continue;
    if (lesson.hasAttention) {
      const att = best.attention;
      if (!att || att.total <= 0 || att.correct / att.total < RETO_ATTENTION_MIN) continue;
      sumCorrect += att.correct;
      sumTotal += att.total;
    }
    done += 1;
  }

  return {
    complete: done === lessons.length,
    completionPct: Math.round((done / lessons.length) * 100),
    attentionScore: sumTotal > 0 ? sumCorrect / sumTotal : 0,
  };
}

function attentionRatio(a: RetoAttemptInfo): number {
  if (!a.attention || a.attention.total <= 0) return 0;
  return a.attention.correct / a.attention.total;
}

// ── Ranking y premios ──

export interface Finisher {
  userId: string;
  /** Timestamp inmutable de finalización verificada (ISO). */
  finishedAt: string;
  /** Atención global al finalizar (desempate 1). */
  attentionScore: number;
  /** Fecha de inscripción (desempate 2: gana quien se inscribió primero). */
  enrolledAt: string;
}

/**
 * Ordena finalizadores: primero por timestamp de finalización; a mismo
 * instante, mayor puntaje de atención; si persiste, inscripción más antigua.
 */
export function rankFinishers(finishers: Finisher[]): Finisher[] {
  return [...finishers].sort((a, b) => {
    const t = Date.parse(a.finishedAt) - Date.parse(b.finishedAt);
    if (t !== 0) return t;
    if (a.attentionScore !== b.attentionScore) return b.attentionScore - a.attentionScore;
    return Date.parse(a.enrolledAt) - Date.parse(b.enrolledAt);
  });
}

/**
 * Asigna premios por orden de llegada: el 1º del ranking recibe la posición 1,
 * el 2º la posición 2... hasta agotar la lista. Devuelve userId → posición.
 */
export function assignPrizes(ranked: Finisher[], prizeCount: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < ranked.length && i < prizeCount; i++) {
    out.set(ranked[i].userId, i + 1);
  }
  return out;
}

// ── Canje de cupos ──

export interface CupoCheck {
  ok: boolean;
  error?: string;
}

/**
 * Valida un canje de cupo (la escritura atómica final la hace el update
 * condicional en DB; esto produce los mensajes de error correctos).
 */
export function validateCupoRedemption(
  cupo: { estado: string; retoId: string } | null,
  reto: { id: string; estadoEfectivo: RetoEstado },
  yaParticipa: boolean
): CupoCheck {
  if (yaParticipa) return { ok: false, error: "Ya estás inscrito en este reto." };
  if (reto.estadoEfectivo !== "publicado" && reto.estadoEfectivo !== "en_curso") {
    return { ok: false, error: "Este reto no está aceptando inscripciones." };
  }
  if (!cupo || cupo.retoId !== reto.id) return { ok: false, error: "Código inválido." };
  if (cupo.estado !== "disponible") return { ok: false, error: "Este código ya fue canjeado." };
  return { ok: true };
}

// ── Estado efectivo por fechas ──

/**
 * Estado derivado en lectura: 'publicado' pasa a 'en_curso' cuando llega
 * fecha_inicio y a 'finalizado' cuando vence fecha_fin. 'borrador' y
 * 'finalizado' persistidos se respetan tal cual.
 */
export function effectiveEstado(
  reto: { estado: RetoEstado; fechaInicio: string | null; fechaFin: string | null },
  now: Date = new Date()
): RetoEstado {
  if (reto.estado === "borrador" || reto.estado === "finalizado") return reto.estado;
  if (reto.fechaFin && now >= new Date(reto.fechaFin)) return "finalizado";
  if (reto.fechaInicio && now >= new Date(reto.fechaInicio)) return "en_curso";
  return reto.estado;
}

// ── Códigos de cupo ──

/** Alfabeto sin caracteres ambiguos (sin 0/O, 1/I). */
export const CUPO_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Genera un código de cupo tipo RETO-XR4K9 a partir de bytes aleatorios. */
export function cupoCodeFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += CUPO_ALPHABET[bytes[i] % CUPO_ALPHABET.length];
  return `RETO-${s}`;
}

// ── Split 80/20 ──

/** Reparte un pago: 80% al creador (redondeado), el resto a la plataforma. */
export function splitPago(amount: number): { creador: number; plataforma: number } {
  const creador = Math.round(amount * 0.8);
  return { creador, plataforma: amount - creador };
}
