"use server";

// Server actions del Tutor/Agente POR RUTA. Vive en la página de la ruta (árbol)
// y responde dudas globales de toda la ruta. Soporta MÚLTIPLES conversaciones
// (threads) por (usuario, ruta), cada una con su propio contexto/memoria.
// Mismo control de acceso que getLesson: dueño siempre; pública para cualquiera;
// bloqueada → nadie. Escrituras solo por service role (RLS bloquea la anónima).

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { isRetoParticipant } from "@/lib/retoAccess";
import { tutorTurnCore } from "@/lib/generation";
import type { Sintesis, Tree, TutorMessage, TutorThread } from "@/lib/types";

const MAX_MESSAGE_LEN = 2000;
/** Cuántos turnos recientes se cargan como memoria para el contexto del modelo. */
const HISTORY_WINDOW = 24;
const DEFAULT_THREAD_TITLE = "Conversación";

/** Acceso a la ruta + sus datos para el tutor; null si no hay permiso. */
async function loadRouteForTutor(userId: string, routeId: string) {
  const { data: route } = await supabaseAdmin()
    .from("routes")
    .select("topic, sintesis, tree, owner_id, visibility, blocked")
    .eq("id", routeId)
    .single();
  if (!route || route.blocked) return null;
  if (
    route.owner_id !== userId &&
    route.visibility !== "public" &&
    !(await isRetoParticipant(supabaseAdmin(), userId, routeId))
  ) {
    return null;
  }
  return route;
}

/** Verifica que el thread pertenezca a este usuario y ruta. */
async function threadBelongsTo(userId: string, routeId: string, threadId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("tutor_threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", userId)
    .eq("route_id", routeId)
    .maybeSingle();
  return Boolean(data);
}

function deriveTitle(message: string): string {
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length > 48 ? clean.slice(0, 48).trimEnd() + "…" : clean || DEFAULT_THREAD_TITLE;
}

/** Lista las conversaciones del tutor para esta ruta (más recientes primero). */
export async function listTutorThreads(token: string, routeId: string): Promise<TutorThread[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];
  const route = await loadRouteForTutor(user.id, routeId);
  if (!route) return [];

  const { data } = await supabaseAdmin()
    .from("tutor_threads")
    .select("id, title, updated_at")
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .order("updated_at", { ascending: false })
    .limit(100);

  return (data || []).map((t) => ({
    id: t.id as string,
    title: (t.title as string) || DEFAULT_THREAD_TITLE,
    updatedAt: t.updated_at as string,
  }));
}

/** Crea una conversación nueva (vacía) y la devuelve. */
export async function createTutorThread(token: string, routeId: string): Promise<TutorThread | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const route = await loadRouteForTutor(user.id, routeId);
  if (!route) return null;

  const { data } = await supabaseAdmin()
    .from("tutor_threads")
    .insert({ user_id: user.id, route_id: routeId, title: DEFAULT_THREAD_TITLE })
    .select("id, title, updated_at")
    .single();
  if (!data) return null;
  return { id: data.id as string, title: data.title as string, updatedAt: data.updated_at as string };
}

/** Borra una conversación y sus mensajes (cascade). */
export async function deleteTutorThread(
  token: string,
  routeId: string,
  threadId: string
): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };
  // El filtro por user_id evita borrar threads ajenos aunque cambie routeId.
  await supabaseAdmin()
    .from("tutor_threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", user.id)
    .eq("route_id", routeId);
  return { ok: true };
}

/** Historial de una conversación (orden cronológico). */
export async function getTutorHistory(
  token: string,
  routeId: string,
  threadId: string
): Promise<TutorMessage[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];
  const route = await loadRouteForTutor(user.id, routeId);
  if (!route) return [];
  if (!(await threadBelongsTo(user.id, routeId, threadId))) return [];

  const { data } = await supabaseAdmin()
    .from("tutor_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);

  return (data || []).map((m) => ({ role: m.role as TutorMessage["role"], content: m.content as string }));
}

export interface TutorTurnResult {
  reply: string;
  error?: string;
}

/** Un turno del tutor en una conversación: persiste el mensaje del usuario y la
 *  respuesta del tutor, y mantiene el título/orden del thread. */
export async function tutorTurn(
  token: string,
  routeId: string,
  threadId: string,
  userMessage: string
): Promise<TutorTurnResult> {
  const user = await getUserFromToken(token);
  if (!user) return { reply: "", error: "Sesión inválida: vuelve a iniciar sesión." };

  const text = userMessage.trim().slice(0, MAX_MESSAGE_LEN);
  if (!text) return { reply: "", error: "Escribe una pregunta." };

  const route = await loadRouteForTutor(user.id, routeId);
  if (!route) return { reply: "", error: "No tienes acceso a esta ruta." };
  if (!(await threadBelongsTo(user.id, routeId, threadId))) {
    return { reply: "", error: "Esa conversación ya no existe." };
  }

  const sb = supabaseAdmin();

  // Memoria reciente (solo de este thread) para el contexto del modelo.
  const { data: histRows } = await sb
    .from("tutor_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .eq("thread_id", threadId)
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
    { user_id: user.id, route_id: routeId, thread_id: threadId, role: "user", content: text },
    { user_id: user.id, route_id: routeId, thread_id: threadId, role: "tutor", content: reply },
  ]);

  // Mantener el thread arriba; si seguía con el título por defecto (primer
  // mensaje), nombrarlo con la primera pregunta del usuario.
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (history.length === 0) update.title = deriveTitle(text);
  await sb.from("tutor_threads").update(update).eq("id", threadId).eq("user_id", user.id);

  return { reply };
}
