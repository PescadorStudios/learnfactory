// ============================================================================
// VOZ (TTS) — narra los subtítulos con la Web Speech API. Sin assets de audio.
// ----------------------------------------------------------------------------
// El reto de Subtítulos Trampa nació "listo para audio" (corría sobre un reloj
// virtual). Aquí llega el audio real vía `speechSynthesis` del navegador (TTS),
// sin archivos: la voz lee cada subtítulo conforme aparece. Degrada con gracia:
// si el navegador no soporta TTS, todo sigue funcionando en silencio.
//
// Agnóstico: solo habla el texto que recibe; no sabe de temas.
//
// 👉 Punto de extensión: si en el futuro un `challenge` trae un `audioUrl` real,
//    este es el lugar para reproducirlo con Howler (ya es dependencia) en vez de
//    TTS. El motor no cambia: solo esta utilidad.
// ============================================================================

export function voiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let warned = false;

export interface SpeakOpts {
  lang?: string;
  rate?: number;
  pitch?: number;
}

/** Habla un texto, interrumpiendo lo anterior (cadencia de subtítulos). */
export function speak(text: string, opts?: SpeakOpts): void {
  if (!voiceSupported() || !text) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // corta la locución previa antes de empezar la nueva
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts?.lang ?? "es-ES";
    u.rate = opts?.rate ?? 1.05;
    u.pitch = opts?.pitch ?? 1;
    synth.speak(u);
  } catch (e) {
    if (!warned) {
      console.warn("[voice] TTS no disponible:", e);
      warned = true;
    }
  }
}

/** Detiene cualquier locución en curso (mute, fin del reto, salida). */
export function stopVoice(): void {
  if (!voiceSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* noop */
  }
}
