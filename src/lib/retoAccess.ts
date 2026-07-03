// Acceso a rutas privadas de retos — SOLO servidor.
// Las rutas de la Academia de Retos nacen con visibility='private' (no salen
// en el catálogo), pero sus participantes inscritos deben poder estudiarlas.
// Este helper amplía los gates existentes sin tocar su lógica: se suma como
// un OR al patrón `dueño || pública`.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ¿Es el usuario participante inscrito del reto asociado a esta ruta?
 * Camino barato: 1 query indexada por ruta_id; solo la pagan rutas privadas
 * a las que un no-dueño intenta entrar.
 */
export async function isRetoParticipant(
  sb: SupabaseClient,
  userId: string,
  routeId: string
): Promise<boolean> {
  const { data: reto } = await sb
    .from("retos")
    .select("id")
    .eq("ruta_id", routeId)
    .maybeSingle();
  if (!reto) return false;

  const { data: part } = await sb
    .from("reto_participantes")
    .select("id")
    .eq("reto_id", reto.id)
    .eq("user_id", userId)
    .maybeSingle();
  return !!part;
}
