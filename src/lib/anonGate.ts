// ──────────────────────────────────────────────────
//  MURO DE REGISTRO PARA VISITANTES SIN CUENTA
// ──────────────────────────────────────────────────
// /scroll y /tunel funcionan sin sesión. Un visitante prueba ANON_FREE_UNITS
// unidades y luego se le invita a crear cuenta GRATIS — nunca a pagar: el
// objetivo aquí es el registro, no la conversión a membresía.
//
// Se cuenta en el navegador porque no hay usuario al que atar la cuenta en la
// base. Es deliberadamente débil: quien limpie el almacenamiento vuelve a
// empezar. Da igual — el coste de esquivarlo es mayor que el de registrarse, y
// el registro es gratis.
//
// DEGRADACIÓN: todo va en try/catch y si el almacenamiento no está disponible
// (Safari en modo privado lanza excepción al tocar localStorage) NO se bloquea.
// Un muro sin memoria solo puede fallar de dos formas: bloqueando siempre
// (hostil) o nunca (inocuo). Elegimos inocuo.

import { ANON_FREE_UNITS } from "./sessionBudget";

const KEY = "lf_anon_units";
const MAX_KEYS = 50; // cota de tamaño; el conteo no depende de la lista

interface AnonState {
  n: number;
  keys: string[];
  since: number;
}

function read(): AnonState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { n: 0, keys: [], since: Date.now() };
    const parsed = JSON.parse(raw) as Partial<AnonState>;
    return {
      n: Number.isFinite(parsed.n) ? Math.max(0, Number(parsed.n)) : 0,
      keys: Array.isArray(parsed.keys) ? parsed.keys.filter(k => typeof k === "string") : [],
      since: Number.isFinite(parsed.since) ? Number(parsed.since) : Date.now(),
    };
  } catch {
    return null; // sin almacenamiento → no se bloquea
  }
}

function write(s: AnonState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: no se bloquea */
  }
}

/**
 * Cuenta una unidad consumida sin cuenta. Deduplica por `itemKey`, así que
 * volver a ver el mismo corto o repetir la misma estación no gasta otra.
 * Devuelve cuántas quedan (o null si no se pudo contar → no bloquear).
 */
export function countAnonUnit(itemKey: string): number | null {
  const s = read();
  if (!s) return null;
  if (s.keys.includes(itemKey)) return Math.max(0, ANON_FREE_UNITS - s.n);
  const keys = [...s.keys, itemKey].slice(-MAX_KEYS);
  const next: AnonState = { n: s.n + 1, keys, since: s.since };
  write(next);
  return Math.max(0, ANON_FREE_UNITS - next.n);
}

/** ¿Ya agotó las unidades de prueba? Ante cualquier duda, false. */
export function isAnonWalled(): boolean {
  const s = read();
  if (!s) return false;
  return s.n >= ANON_FREE_UNITS;
}

/** Unidades de prueba restantes (ANON_FREE_UNITS si no se puede saber). */
export function anonRemaining(): number {
  const s = read();
  if (!s) return ANON_FREE_UNITS;
  return Math.max(0, ANON_FREE_UNITS - s.n);
}

export { ANON_FREE_UNITS };
