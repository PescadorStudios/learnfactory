"use server";

// ============================================================================
// SERVER ACTIONS DE EL TÚNEL
// ----------------------------------------------------------------------------
// Único puente entre el cliente del túnel (audio/voice.ts) y el backend de
// Learn Factory. Envuelve synthesizeSpeech() — el MISMO TTS (Gemini, voz
// "Charon") que narra las lecciones — y devuelve el WAV en base64 para que el
// cliente lo cachee en IndexedDB (mismo patrón que el resto de la app, ver
// src/lib/audioCache.ts: base64ToWavBlob → putAudio).
// ============================================================================

import { synthesizeSpeech } from "@/lib/generation";

// Tope de longitud. Los subtítulos del demo son cortos; además esta action es
// un endpoint POST público (la ruta /tunel no exige sesión), así que acotamos
// el texto para no dejar abierto un generador de TTS contra la cuota de Gemini.
const MAX_TTS_CHARS = 320;

/**
 * Sintetiza una línea con la voz de Learn Factory (Charon) y la devuelve en
 * base64 (WAV). `null` si el texto es inválido o si el TTS falla tras reintentos
 * (el cliente cae entonces a Web Speech, sin cortar el juego).
 */
export async function synthesizeTunnelSpeech(
  text: string
): Promise<{ audioBase64: string; durationSeconds: number } | null> {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_TTS_CHARS) return null;

  const result = await synthesizeSpeech(clean);
  if (!result) return null;

  return {
    audioBase64: result.wav.toString("base64"),
    durationSeconds: result.durationSeconds,
  };
}
