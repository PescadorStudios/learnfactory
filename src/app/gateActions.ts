"use server";

// Server actions del muro de sesiones. Patrón del proyecto: el token va como
// primer argumento, se resuelve el usuario y se trabaja con el service role.
// La lógica vive en src/lib/sessionGate.ts; aquí solo está la frontera.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { getGateState, type GateState } from "@/lib/sessionGate";
import { SESSION_BUDGET } from "@/lib/sessionGate";

export type { GateState };

/**
 * Estado del muro para pintar el medidor y la pantalla de bloqueo. No cobra
 * nada. Sin sesión devuelve null (los anónimos se cuentan en el navegador, ver
 * src/lib/anonGate.ts).
 */
export async function getStudyGate(token: string): Promise<GateState | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  return getGateState(supabaseAdmin(), user.id);
}

/** El tope vigente, para que el cliente sepa si merece la pena pintar el medidor. */
export async function getSessionBudget(): Promise<number> {
  return SESSION_BUDGET;
}
