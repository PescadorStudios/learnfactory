"use server";

// Server actions de gamificación de escucha/recorrido (global por usuario).
// El nivel se deriva en el cliente (src/lib/listeningLevels.ts); aquí solo se
// acumula el valor crudo en profiles. Patrón: verificar token + service role.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { consumeStudyUnit, getGateState } from "@/lib/sessionGate";
import type { GateState } from "@/lib/types";

/** Tope de delta por flush: ~10 min. Evita inflar el contador por bugs/abusos. */
const MAX_PODCAST_DELTA = 600;

export interface ListeningStats {
  podcastSeconds: number;
  tunnelLessons: number;
  scrollSeconds: number;
}

/** Suma tiempo escuchado en Podcast y devuelve el total acumulado. */
export async function addPodcastListening(
  token: string,
  deltaSeconds: number
): Promise<{ totalSeconds: number }> {
  const user = await getUserFromToken(token);
  if (!user) return { totalSeconds: 0 };

  const delta = Math.max(0, Math.min(MAX_PODCAST_DELTA, Math.round(deltaSeconds)));
  if (delta === 0) {
    const { data } = await supabaseAdmin()
      .from("profiles")
      .select("podcast_seconds")
      .eq("id", user.id)
      .single();
    return { totalSeconds: (data?.podcast_seconds as number) ?? 0 };
  }

  const sb = supabaseAdmin();
  const { data: prev } = await sb
    .from("profiles")
    .select("podcast_seconds")
    .eq("id", user.id)
    .single();
  const total = ((prev?.podcast_seconds as number) ?? 0) + delta;
  await sb.from("profiles").update({ podcast_seconds: total }).eq("id", user.id);
  return { totalSeconds: total };
}

/** Suma tiempo visto en Modo Scroll y devuelve el total acumulado. */
export async function addScrollWatching(
  token: string,
  deltaSeconds: number
): Promise<{ totalSeconds: number }> {
  const user = await getUserFromToken(token);
  if (!user) return { totalSeconds: 0 };

  const delta = Math.max(0, Math.min(MAX_PODCAST_DELTA, Math.round(deltaSeconds)));
  if (delta === 0) {
    const { data } = await supabaseAdmin()
      .from("profiles")
      .select("scroll_seconds")
      .eq("id", user.id)
      .single();
    return { totalSeconds: (data?.scroll_seconds as number) ?? 0 };
  }

  const sb = supabaseAdmin();
  const { data: prev } = await sb
    .from("profiles")
    .select("scroll_seconds")
    .eq("id", user.id)
    .single();
  const total = ((prev?.scroll_seconds as number) ?? 0) + delta;
  await sb.from("profiles").update({ scroll_seconds: total }).eq("id", user.id);
  return { totalSeconds: total };
}

/**
 * Marca una lección/estación del Túnel y devuelve el total acumulado.
 *
 * `stationId` es obligatorio y sirve de clave de idempotencia del muro: los ids
 * de estación son estables (`${lessonId}__${podId}`), así que volver a pasar por
 * la misma estación no vuelve a cobrar unidad.
 */
export async function recordTunnelLesson(
  token: string,
  stationId: string
): Promise<{ totalLessons: number; gate?: GateState }> {
  const user = await getUserFromToken(token);
  if (!user) return { totalLessons: 0 };

  const sb = supabaseAdmin();
  const { data: prev } = await sb
    .from("profiles")
    .select("tunnel_lessons")
    .eq("id", user.id)
    .single();
  const total = ((prev?.tunnel_lessons as number) ?? 0) + 1;
  await sb.from("profiles").update({ tunnel_lessons: total }).eq("id", user.id);

  // El recorrido ya ocurrió: se cuenta igual y el muro solo decide si se puede
  // ENTRAR a la siguiente estación.
  let gate: GateState | undefined;
  try {
    gate = await consumeStudyUnit(sb, user.id, "tunel", stationId || "estacion");
  } catch (e) {
    console.warn("[sessionGate] no se pudo cobrar la unidad del túnel:", e);
  }
  return { totalLessons: total, gate };
}

/**
 * Cobra un episodio de Podcast. No existe fila por episodio en la base y el
 * catálogo entrega las URLs en lote, así que ESTA es la única señal de "empezó a
 * escuchar un episodio". El cliente la respeta para no avanzar la cola.
 *
 * OJO: `addPodcastListening` NO puede cobrar (se dispara cada 30 s y vaciaría la
 * bolsa en un solo episodio); por eso hay una acción aparte.
 */
export async function startPodcastEpisode(
  token: string,
  routeId: string,
  nodeId: string
): Promise<{ allowed: boolean; gate: GateState | null }> {
  const user = await getUserFromToken(token);
  if (!user) return { allowed: true, gate: null };

  const r = await consumeStudyUnit(
    supabaseAdmin(),
    user.id,
    "podcast",
    `${routeId}:${nodeId}`,
    routeId
  );
  return { allowed: r.allowed, gate: r };
}

/** Estado del muro para sembrar el reproductor/feed al montar. */
export async function getStudyGateState(token: string): Promise<GateState | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  return getGateState(supabaseAdmin(), user.id);
}

/** Lee los contadores actuales (para pintar niveles al entrar). */
export async function getListeningStats(token: string): Promise<ListeningStats> {
  const user = await getUserFromToken(token);
  if (!user) return { podcastSeconds: 0, tunnelLessons: 0, scrollSeconds: 0 };

  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("podcast_seconds, tunnel_lessons, scroll_seconds")
    .eq("id", user.id)
    .single();
  return {
    podcastSeconds: (data?.podcast_seconds as number) ?? 0,
    tunnelLessons: (data?.tunnel_lessons as number) ?? 0,
    scrollSeconds: (data?.scroll_seconds as number) ?? 0,
  };
}
