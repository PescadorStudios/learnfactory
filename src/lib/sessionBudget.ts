// ──────────────────────────────────────────────────
//  MURO DE SESIONES — aritmética PURA
// ──────────────────────────────────────────────────
// Este módulo no toca la base de datos ni el servidor: son funciones puras para
// poder testearlas en aislamiento (src/lib/sessionBudget.test.ts). El
// orquestador con DB vive en src/lib/sessionGate.ts, y el estado real lo calcula
// la RPC `consume_study_unit` (scripts/session-wall-setup.sql).
//
// Mismo patrón que src/lib/retoLogic.ts ↔ src/lib/retoFulfillment.ts.

/** Unidades gratis por sesión. Bolsa COMPARTIDA entre los 4 modos. */
export const SESSION_BUDGET_DEFAULT = 5;

/** Duración del bloqueo cuando se agota la bolsa. */
export const LOCK_HOURS = 4;

/** Unidades que prueba un visitante SIN cuenta antes del muro de registro. */
export const ANON_FREE_UNITS = 3;

/**
 * % mínimo visto para que un corto del Modo Scroll cuente como unidad.
 * `registrarCortoEvento` también se dispara al dar like/guardar/abrir-ruta, así
 * que sin este umbral un doble-tap quemaría la bolsa.
 */
export const CORTO_MIN_PCT = 60;

/** Los 4 modos de consumo. */
export type StudyKind = "lesson" | "podcast" | "corto" | "tunel";

/** Lo que hace falta de `profiles` para decidir si hay acceso ilimitado. */
export interface MembershipInfo {
  plan: string | null;
  founder: boolean;
  premiumUntil: string | Date | null;
}

function toMs(v: string | Date | null | undefined): number | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * ¿El usuario estudia sin límites?
 *   - `founder` (compró el Premium de pago único) → SIEMPRE, de por vida.
 *   - membresía mensual → solo mientras `premiumUntil` esté en el futuro.
 * Es DERIVADO: nadie degrada `plan` al vencer, así no se pierde la señal
 * "fue miembro" que necesitan el win-back y el panel de admin.
 */
export function isMembershipActive(m: MembershipInfo, now: Date = new Date()): boolean {
  if (m.founder) return true;
  if (m.plan !== "premium") return false;
  const until = toMs(m.premiumUntil);
  if (until === null) return false;
  return until > now.getTime();
}

/** Razón del acceso, para copy y métricas. */
export function membershipReason(
  m: MembershipInfo,
  now: Date = new Date()
): "founder" | "membership" | "free" {
  if (m.founder) return "founder";
  if (isMembershipActive(m, now)) return "membership";
  return "free";
}

/**
 * Cuántas unidades quedan y si la PRÓXIMA cierra la ventana.
 * Ojo al off-by-one: con budget 5 se entregan cinco unidades; la quinta se sirve
 * y el muro cae justo después.
 */
export function budgetAfter(
  unitsUsed: number,
  budget: number
): { remaining: number; willLock: boolean } {
  const used = Math.max(0, Math.floor(unitsUsed));
  const total = Math.max(0, Math.floor(budget));
  const remaining = Math.max(0, total - used);
  return { remaining, willLock: remaining <= 1 };
}

/** ¿Sigue vigente el bloqueo, y cuánto falta? */
export function lockState(
  lockedUntil: string | Date | null,
  now: Date = new Date()
): { locked: boolean; msLeft: number } {
  const until = toMs(lockedUntil);
  if (until === null) return { locked: false, msLeft: 0 };
  const msLeft = until - now.getTime();
  return msLeft > 0 ? { locked: true, msLeft } : { locked: false, msLeft: 0 };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Reloj del bloqueo: "3h 47m 12s" / "47m 12s" / "0m 09s". Cadena vacía cuando ya
 * se cumplió el tiempo (o si llega un valor negativo), para que la UI no pinte
 * un contador en negativo.
 */
export function formatCountdown(msLeft: number): string {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return "";
  const total = Math.ceil(msLeft / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

/**
 * ¿Toca avisar "tu membresía vence en N días"?
 * La idempotencia NO es un booleano: se guarda el `premiumUntil` PARA EL QUE se
 * avisó. Al renovar, `premiumUntil` se mueve → deja de coincidir → el aviso se
 * re-arma solo, sin lógica de reinicio.
 */
export function renewalReminderDue(
  premiumUntil: string | Date | null,
  notifiedFor: string | Date | null,
  now: Date = new Date(),
  daysBefore = 3
): boolean {
  const until = toMs(premiumUntil);
  if (until === null) return false;
  const t = now.getTime();
  if (until <= t) return false; // ya venció: eso lo cubre lapseNoticeDue
  if (until - daysBefore * 86_400_000 > t) return false; // aún es pronto
  return toMs(notifiedFor) !== until;
}

/** ¿Toca avisar "tu membresía venció"? */
export function lapseNoticeDue(
  premiumUntil: string | Date | null,
  notifiedFor: string | Date | null,
  now: Date = new Date()
): boolean {
  const until = toMs(premiumUntil);
  if (until === null) return false;
  if (until > now.getTime()) return false;
  return toMs(notifiedFor) !== until;
}

/**
 * Nuevo vencimiento tras un pago: se ACUMULA sobre el que ya hubiera si aún
 * está vigente, para que renovar temprano no pierda días.
 */
export function extendMembership(
  currentUntil: string | Date | null,
  days: number,
  now: Date = new Date()
): Date {
  const current = toMs(currentUntil);
  const base = current !== null && current > now.getTime() ? current : now.getTime();
  return new Date(base + Math.max(0, days) * 86_400_000);
}
