"use server";

// Server actions de gamificación de escucha/recorrido (global por usuario).
// El nivel se deriva en el cliente (src/lib/listeningLevels.ts); aquí solo se
// acumula el valor crudo en profiles. Patrón: verificar token + service role.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";

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

/** Marca una lección/estación del Túnel y devuelve el total acumulado. */
export async function recordTunnelLesson(token: string): Promise<{ totalLessons: number }> {
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
  return { totalLessons: total };
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
