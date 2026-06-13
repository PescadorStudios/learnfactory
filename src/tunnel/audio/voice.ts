// ============================================================================
// VOZ (TTS) — narra los subtítulos con la VOZ DE LEARN FACTORY (Gemini "Charon").
// ----------------------------------------------------------------------------
// El Túnel nació con la Web Speech del navegador. Ahora usa la MISMA voz que el
// resto de Learn Factory: el TTS de Gemini (voz Charon), vía la Server Action
// `synthesizeTunnelSpeech` (que envuelve synthesizeSpeech() del backend). El WAV
// se cachea en IndexedDB (audioCache) — igual que las lecciones — así que en
// repeticiones suena al instante y sin coste.
//
// Degradación elegante, en orden: Charon cacheado → Charon recién sintetizado →
// Web Speech del navegador → silencio. El reto SIEMPRE corre sobre su reloj
// virtual: esta utilidad nunca lo bloquea ni lo retrasa.
//
// Interfaz estable: speak() / stopVoice() / voiceSupported(), + primeVoice()
// para precalentar la caché al montar el reto (que el primer subtítulo ya suene
// en Charon). Agnóstico: solo habla el texto que recibe; no sabe de temas.
// ============================================================================

import { synthesizeTunnelSpeech } from "@/app/tunnelActions";
import { base64ToWavBlob, getAudio, putAudio } from "@/lib/audioCache";

export interface SpeakOpts {
  lang?: string;
  rate?: number;
  pitch?: number;
}

// --- Web Speech (fallback) ---------------------------------------------------

function webSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let warnedWeb = false;

function speakWeb(text: string, opts?: SpeakOpts): void {
  if (!webSpeechSupported() || !text) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // corta la locución previa antes de la nueva
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts?.lang ?? "es-ES";
    u.rate = opts?.rate ?? 1.05;
    u.pitch = opts?.pitch ?? 1;
    synth.speak(u);
  } catch (e) {
    if (!warnedWeb) {
      console.warn("[voice] Web Speech no disponible:", e);
      warnedWeb = true;
    }
  }
}

function stopWeb(): void {
  if (!webSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* noop */
  }
}

/** ¿Se puede narrar? En el cliente sí: Charon (servidor) o, si falla, Web Speech. */
export function voiceSupported(): boolean {
  return typeof window !== "undefined";
}

// --- Charon (Gemini TTS, vía Server Action + caché IndexedDB) ----------------

const KEY_PREFIX = "tunnel-tts:v1:";

/** Clave de caché estable y corta a partir del texto (djb2 en hex + longitud). */
function cacheKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${KEY_PREFIX}${(h >>> 0).toString(16)}:${text.length}`;
}

// URLs de objeto ya listas (por texto) para no recrearlas. Vida = sesión.
const urlByText = new Map<string, string>();
// Síntesis en vuelo (de-dup): nunca pedir dos veces el mismo texto a la vez.
const inFlight = new Map<string, Promise<string | null>>();

// Si Charon falla "duro" varias veces (sin API key, caído…), dejamos de
// insistir por esta sesión y narramos con Web Speech, sin martillear el endpoint.
let charonFails = 0;
let charonDisabled = false;
const CHARON_FAIL_LIMIT = 2;

async function getCharonUrl(text: string): Promise<string | null> {
  if (charonDisabled) return null;

  const cached = urlByText.get(text);
  if (cached) return cached;

  const pending = inFlight.get(text);
  if (pending) return pending;

  const job = (async (): Promise<string | null> => {
    const key = cacheKey(text);
    try {
      // 1) IndexedDB (persistente entre sesiones y visitas).
      let blob = await getAudio(key);
      // 2) Síntesis con Charon si no estaba cacheado.
      if (!blob) {
        const res = await synthesizeTunnelSpeech(text);
        if (!res) {
          charonFails += 1;
          if (charonFails >= CHARON_FAIL_LIMIT) charonDisabled = true;
          return null; // fallo: speak() usará Web Speech para esta línea
        }
        charonFails = 0;
        blob = base64ToWavBlob(res.audioBase64);
        await putAudio(key, blob);
      }
      const url = URL.createObjectURL(blob);
      urlByText.set(text, url);
      return url;
    } catch (e) {
      console.warn("[voice] Charon no disponible, se usará Web Speech:", e);
      return null;
    } finally {
      inFlight.delete(text);
    }
  })();

  inFlight.set(text, job);
  return job;
}

// --- Reproducción ------------------------------------------------------------

let audioEl: HTMLAudioElement | null = null;

function getAudioEl(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

// Descarta resultados asíncronos obsoletos: si otra locución empezó o se llamó
// stopVoice() mientras Charon sintetizaba, el audio que llega tarde se ignora.
let playToken = 0;

function stopPlayback(): void {
  stopWeb();
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* noop */
    }
  }
}

/**
 * Narra un texto con la voz de Learn Factory (Charon), interrumpiendo lo
 * anterior. No bloquea: si Charon aún no está listo o falla, cae a Web Speech.
 */
export function speak(text: string, opts?: SpeakOpts): void {
  if (!text || typeof window === "undefined") return;
  const token = ++playToken;
  stopPlayback(); // corta lo previo (Charon + Web Speech)

  void getCharonUrl(text).then((url) => {
    if (token !== playToken) return; // llegó tarde: hay otra locución o un stop
    if (!url) {
      speakWeb(text, opts); // Charon no disponible → fallback inmediato
      return;
    }
    try {
      const el = getAudioEl();
      el.src = url;
      const p = el.play();
      if (p && typeof p.catch === "function") {
        // Autoplay bloqueado u otro error de reproducción → Web Speech.
        p.catch(() => {
          if (token === playToken) speakWeb(text, opts);
        });
      }
    } catch {
      if (token === playToken) speakWeb(text, opts);
    }
  });
}

/** Detiene cualquier locución en curso (mute, fin del reto, salida del túnel). */
export function stopVoice(): void {
  playToken++; // invalida cualquier síntesis en vuelo a punto de sonar
  stopPlayback();
}

/**
 * Precalienta la caché de Charon para una lista de textos. Se llama al montar
 * el reto: sintetiza/cachea en segundo plano (sin reproducir) para que cada
 * subtítulo ya suene en Charon. Ignora errores; lo que no llegue a tiempo cae
 * a Web Speech en su momento.
 */
export function primeVoice(texts: string[]): void {
  if (typeof window === "undefined" || charonDisabled) return;
  for (const raw of texts) {
    const text = (raw ?? "").trim();
    if (text && !urlByText.has(text) && !inFlight.has(text)) {
      void getCharonUrl(text); // dispara y olvida; getCharonUrl de-dup y cachea
    }
  }
}
