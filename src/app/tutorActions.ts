"use server";

// Server actions del Tutor/Agente POR RUTA. Vive en la página de la ruta (árbol)
// y responde dudas globales de toda la ruta, con memoria por (usuario, ruta).
// Mismo control de acceso que getLesson: dueño siempre; pública para cualquiera;
// bloqueada → nadie. Escrituras solo por service role (RLS bloquea la anónima).

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { tutorTurnCore } from "@/lib/generation";
import type { Sintesis, Tree, TutorMessage } from "@/lib/types";

const MAX_MESSAGE_LEN = 2000;
/** Cuántos turnos recientes se cargan como memoria para el contexto del modelo. */
const HISTORY_WINDOW = 24;

/** Acceso a la ruta + sus datos para el tutor; null si no hay permiso. */
async function loadRouteForTutor(userId: string, routeId: string) {
  const { data: route } = await supabaseAdmin()
    .from("routes")
    .select("topic, sintesis, tree, owner_id, visibility, blocked")
    .eq("id", routeId)
    .single();
  if (!route || route.blocked) return null;
  if (route.owner_id !== userId && route.visibility !== "public") return null;
  return route;
}

/** Historial del tutor para esta ruta (orden cronológico). */
export async function getTutorHistory(token: string, routeId: string): Promise<TutorMessage[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];
  const route = await loadRouteForTutor(user.id, routeId);
  if (!route) return [];

  const { data } = await supabaseAdmin()
    .from("tutor_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .order("created_at", { ascending: true })
    .limit(200);

  return (data || []).map((m) => ({ role: m.role as TutorMessage["role"], content: m.content as string }));
}

export interface TutorTurnResult {
  reply: string;
  error?: string;
}

/** Un turno del tutor: persiste el mensaje del usuario y la respuesta del tutor. */
export async function tutorTurn(
  token: string,
  routeId: string,
  userMessage: string
): Promise<TutorTurnResult> {
  const user = await getUserFromToken(token);
  if (!user) return { reply: "", error: "Sesión inválida: vuelve a iniciar sesión." };

  const text = userMessage.trim().slice(0, MAX_MESSAGE_LEN);
  if (!text) return { reply: "", error: "Escribe una pregunta." };

  const route = await loadRouteForTutor(user.id, routeId);
  if (!route) return { reply: "", error: "No tienes acceso a esta ruta." };

  const sb = supabaseAdmin();

  // Memoria reciente para el contexto del modelo.
  const { data: histRows } = await sb
    .from("tutor_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  const history: TutorMessage[] = (histRows || [])
    .reverse()
    .map((m) => ({ role: m.role as TutorMessage["role"], content: m.content as string }));

  const reply = await tutorTurnCore(
    route.topic as string,
    route.sintesis as Sintesis,
    route.tree as Tree,
    history,
    text
  );

  // Persistir ambos mensajes (el del usuario y la respuesta del tutor).
  await sb.from("tutor_messages").insert([
    { user_id: user.id, route_id: routeId, role: "user", content: text },
    { user_id: user.id, route_id: routeId, role: "tutor", content: reply },
  ]);

  return { reply };
}
