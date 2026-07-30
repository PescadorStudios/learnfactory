"use server";

// Server actions del muro de sesiones. Patrón del proyecto: el token va como
// primer argumento, se resuelve el usuario y se trabaja con el service role.
// La lógica vive en src/lib/sessionGate.ts; aquí solo está la frontera.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { getGateState, SESSION_BUDGET } from "@/lib/sessionGate";
import type { GateState } from "@/lib/types";

// OJO: aquí NO puede haber `export type { ... }`. Next intenta registrar CADA
// export de un archivo "use server" como server action, y al re-exportar un tipo
// importado emite una referencia en tiempo de ejecución a algo que no existe como
// valor → "ReferenceError: GateState is not defined", que tumba las acciones de
// la petición (síntoma: el árbol se quedaba en "Cargando tu ruta..."). El tipo se
// importa desde @/lib/types, que es donde vive. `next build` NO lo detecta.

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
