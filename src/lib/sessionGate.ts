// ============================================================================
// Muro de sesiones — orquestador con base de datos. SOLO servidor.
// ----------------------------------------------------------------------------
// La aritmética pura vive en src/lib/sessionBudget.ts (testeada). El trabajo
// atómico —candado de fila, ledger, incremento y cierre de ventana— lo hace la
// RPC `consume_study_unit` de scripts/session-wall-setup.sql, para que dos
// peticiones simultáneas no puedan servir ambas la última unidad.
//
// Mismo reparto que src/lib/retoLogic.ts ↔ src/lib/retoFulfillment.ts.
// ============================================================================
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SESSION_BUDGET_DEFAULT,
  LOCK_HOURS,
  budgetAfter,
  isMembershipActive,
  lockState,
  membershipReason,
  type StudyKind,
} from "./sessionBudget";

import type { GateState } from "./types";

export type { StudyKind, GateState };

/**
 * Unidades gratis por sesión. Se puede pisar con SESSION_WALL_BUDGET para
 * desplegar el conteo con un tope altísimo (p. ej. 999) y ver el ledger
 * llenarse con tráfico real ANTES de activar el muro de verdad.
 */
export const SESSION_BUDGET: number = (() => {
  const raw = Number(process.env.SESSION_WALL_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : SESSION_BUDGET_DEFAULT;
})();

export interface ConsumeResult extends GateState {
  /** false = no se sirve la unidad (bloqueo vigente). */
  allowed: boolean;
  /** true = esta unidad ya estaba contada en la ventana; no se volvió a cobrar. */
  already: boolean;
}

/** Estado de quien no tiene límite. Nunca toca study_sessions. */
function unlimitedState(reason: "founder" | "membership"): GateState {
  return {
    unlimited: true,
    reason,
    walled: false,
    unitsUsed: 0,
    budget: SESSION_BUDGET,
    remaining: SESSION_BUDGET,
    lockedUntil: null,
  };
}

/**
 * Postura ante un fallo de infraestructura (falta correr la migración, la RPC no
 * existe, la base no responde): NO bloquear a nadie. Un muro roto que encierra a
 * toda la base de usuarios es infinitamente peor que un muro que deja pasar.
 */
function failOpen(): GateState {
  return { ...unlimitedState("membership"), reason: "free" };
}

interface MembershipRow {
  plan: string | null;
  founder: boolean | null;
  premium_until: string | null;
}

/**
 * Lee la membresía. Tolerante a que falten las columnas nuevas (igual que
 * src/lib/premium.ts): si el select falla, se reintenta con `plan` a secas.
 * Devuelve null solo si no se pudo leer nada.
 */
async function readMembership(
  sb: SupabaseClient,
  userId: string
): Promise<MembershipRow | null> {
  const { data, error } = await sb
    .from("profiles")
    .select("plan, founder, premium_until")
    .eq("id", userId)
    .maybeSingle();

  if (!error) return (data as MembershipRow) ?? { plan: "free", founder: false, premium_until: null };

  console.warn(
    `[sessionGate] no se pudieron leer founder/premium_until (¿falta correr scripts/session-wall-setup.sql?): ${error.message}`
  );
  const { data: basic, error: e2 } = await sb
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();
  if (e2) return null;
  return { plan: (basic?.plan as string) ?? "free", founder: false, premium_until: null };
}

/** ¿Tiene acceso ilimitado? Derivado, nunca almacenado. */
function unlimitedReason(m: MembershipRow): "founder" | "membership" | null {
  const info = {
    plan: m.plan,
    founder: Boolean(m.founder),
    premiumUntil: m.premium_until,
  };
  if (!isMembershipActive(info)) return null;
  const r = membershipReason(info);
  return r === "free" ? null : r;
}

function toState(
  unitsUsed: number,
  budget: number,
  lockedUntil: string | null
): GateState {
  const { locked } = lockState(lockedUntil);
  const { remaining } = budgetAfter(unitsUsed, budget);
  return {
    unlimited: false,
    reason: "free",
    walled: locked,
    unitsUsed,
    budget,
    remaining,
    lockedUntil: locked ? lockedUntil : null,
  };
}

/**
 * Estado del muro SIN cobrar nada (medidor, pantalla de bloqueo, correos).
 * Los usuarios con acceso ilimitado salen antes de tocar `study_sessions`, así
 * que no generan ni una fila ni una consulta extra.
 */
export async function getGateState(sb: SupabaseClient, userId: string): Promise<GateState> {
  const m = await readMembership(sb, userId);
  if (!m) return failOpen();

  const unlimited = unlimitedReason(m);
  if (unlimited) return unlimitedState(unlimited);

  const { data, error } = await sb.rpc("study_gate_state", { p_user: userId });
  if (error) {
    console.warn(`[sessionGate] study_gate_state falló, no se bloquea: ${error.message}`);
    return failOpen();
  }

  const row = (data as { r_units: number; r_budget: number; r_locked_until: string | null }[] | null)?.[0];
  // Sin fila = sesión nueva: la bolsa está intacta.
  if (!row) return toState(0, SESSION_BUDGET, null);
  return toState(row.r_units ?? 0, row.r_budget ?? SESSION_BUDGET, row.r_locked_until ?? null);
}

/**
 * Cobra UNA unidad de estudio de forma atómica e idempotente.
 *
 * `itemKey` identifica la unidad dentro de la ventana: 'routeId:nodeId' para
 * lección/podcast/corto, o el stationId del Túnel. Repetir la misma unidad
 * devuelve `already: true` y NO vuelve a cobrar.
 *
 * OJO: `allowed: false` significa "no sirvas más contenido". No significa
 * "descarta el trabajo del usuario": quien ya completó una lección debe guardar
 * su intento igualmente (ver saveAttempt).
 */
export async function consumeStudyUnit(
  sb: SupabaseClient,
  userId: string,
  kind: StudyKind,
  itemKey: string,
  routeId?: string | null
): Promise<ConsumeResult> {
  const m = await readMembership(sb, userId);
  if (!m) return { ...failOpen(), allowed: true, already: false };

  const unlimited = unlimitedReason(m);
  if (unlimited) return { ...unlimitedState(unlimited), allowed: true, already: false };

  const { data, error } = await sb.rpc("consume_study_unit", {
    p_user: userId,
    p_kind: kind,
    p_item_key: itemKey,
    p_route_id: routeId ?? null,
    p_budget: SESSION_BUDGET,
    p_lock_hours: LOCK_HOURS,
  });

  if (error) {
    console.warn(`[sessionGate] consume_study_unit falló, no se bloquea: ${error.message}`);
    return { ...failOpen(), allowed: true, already: false };
  }

  const row = (data as
    | {
        r_allowed: boolean;
        r_already: boolean;
        r_units: number;
        r_budget: number;
        r_locked_until: string | null;
      }[]
    | null)?.[0];
  if (!row) return { ...failOpen(), allowed: true, already: false };

  return {
    ...toState(row.r_units ?? 0, row.r_budget ?? SESSION_BUDGET, row.r_locked_until ?? null),
    allowed: Boolean(row.r_allowed),
    already: Boolean(row.r_already),
  };
}
