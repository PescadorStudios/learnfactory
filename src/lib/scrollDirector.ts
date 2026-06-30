// El "Director" del Modo Scroll. SOLO servidor.
// Una pasada de Gemini (offline, UNA vez por lección) que convierte una lección
// en un timeline declarativo de "cues": cada cue elige un componente del
// VOCABULARIO CERRADO y lo codifica con props. Doble codificación (Paivio): cada
// cue representa visualmente el MISMO significado que narra el audio.
//
// MULTIMODAL: el AUDIO se sube a la File API de Gemini (camino fiable, no
// base64 inline) y es la ÚNICA fuente de verdad: el modelo lo "escucha" y ubica
// cada cue con start_ms/end_ms reales. NO le damos la síntesis global de la ruta
// como contenido (eso causaba que, cuando no lograba oír el audio, el corto
// hablara del tema de la RUTA y no de la lección). Pedimos además un "transcript"
// como prueba de que sí escuchó: si viene vacío, descartamos el resultado.
// Si no hay audio legible, caemos al método por texto (los pasos de ESTA lección).
import "server-only";
import { getJsonModel, parseJsonResponse, uploadAudioToGemini } from "@/lib/generation";
import {
  COMPONENTES_SCROLL,
  type ComponenteScroll,
  type LessonTimeline,
  type TimelineCue,
  type Sintesis,
  type LessonStep,
} from "@/lib/types";

const VOCAB = new Set<string>(COMPONENTES_SCROLL);
const MAX_BEATS = 16;
const MIN_BEATS = 3;
const TEXT_TIMEOUT_MS = 60_000;
const AUDIO_TIMEOUT_MS = 120_000; // escuchar + razonar sobre ~3 min de audio
const MIN_CUE_MS = 600;

export interface TimelineLessonInput {
  routeId: string;
  nodeId: string;
  title: string;
  /** Pasos de la lección (referencia semántica; fallback si no hay audio). */
  steps: LessonStep[] | null;
  conceptIds: string[];
  audioUrl: string;
  audioDurationSeconds: number;
}

interface RawBeat {
  componente?: string;
  props?: Record<string, unknown>;
  peso?: number;
}
interface RawTimedCue {
  start_ms?: number;
  end_ms?: number;
  componente?: string;
  props?: Record<string, unknown>;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} agotó el tiempo (${ms}ms)`)), ms)),
  ]);
}

function stepsToText(steps: LessonStep[] | null): string {
  if (!steps?.length) return "";
  const parts: string[] = [];
  for (const s of steps) {
    if (s.type === "theory" || s.type === "analogy") {
      parts.push(`### ${s.title}\n${s.content}${s.cita ? `\nCita: "${s.cita}"` : ""}`);
    } else if (s.type === "elaboration" || s.type === "debate") {
      parts.push(`### ${s.title}\n${s.prompt}`);
    } else if (s.type === "quiz") {
      parts.push(`### ${s.title}\n${s.question}`);
    }
  }
  return parts.join("\n\n");
}

/** Nombres de los conceptos que cubre ESTA lección (apoyo ortográfico, no global). */
function lessonConceptsText(sintesis: Sintesis, conceptIds: string[]): string {
  if (!sintesis?.conceptos?.length || !conceptIds?.length) return "";
  const set = new Set(conceptIds);
  const names = sintesis.conceptos.filter(c => set.has(c.id)).map(c => `- ${c.nombre}`);
  return names.join("\n");
}

const VOCAB_GUIDE = `VOCABULARIO VISUAL CERRADO (elige SOLO de esta lista; nunca inventes un componente):
- "TermCallout": un término clave + su definición breve. props: { "termino": string, "definicion": string }
- "BuildList": una lista que se construye ítem a ítem. props: { "titulo"?: string, "items": string[] }
- "VersusSplit": comparación a dos columnas (A vs B). props: { "izquierda": { "titulo": string, "puntos": string[] }, "derecha": { "titulo": string, "puntos": string[] } }
- "Timeline": secuencia temporal / hitos en orden. props: { "hitos": [{ "etiqueta": string, "detalle"?: string }] }
- "NodeGraph": una jerarquía o relaciones entre ideas. props: { "raiz": string, "ramas": string[] }
- "Counter": una cantidad que cuenta hasta un valor. props: { "valor": number, "sufijo"?: string, "etiqueta": string }
- "StepFlow": un proceso de pasos secuenciales. props: { "pasos": string[] }
- "QuoteBeat": una cita textual destacada. props: { "cita": string, "autor"?: string }
- "KeyImage": una idea ancla con un rótulo (sin imagen real: ícono conceptual + texto). props: { "icono"?: string, "rotulo": string, "subtexto"?: string }
- "ProgressBar": un avance o proporción. props: { "etiqueta": string, "pct": number }

REGLA DE DOBLE CODIFICACIÓN (obligatoria): cada cue debe CODIFICAR el significado de lo que se narra en ese momento, no decorarlo.
- una comparación → VersusSplit · un proceso → StepFlow · una secuencia temporal → Timeline
- una jerarquía/relaciones → NodeGraph · una cantidad → Counter · un término → TermCallout
- una idea-lista → BuildList · una cita → QuoteBeat · una proporción/avance → ProgressBar · una idea ancla → KeyImage
PROHIBIDO el visual decorativo que no representa la idea.`;

/** Sube el audio a la File API de Gemini y devuelve la parte fileData. null si falla. */
async function fetchAudioPart(audioUrl: string, displayName: string): Promise<{ fileData: { mimeType: string; fileUri: string } } | null> {
  try {
    const res = await fetch(audioUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    const mimeType = audioUrl.toLowerCase().endsWith(".mp3") ? "audio/mp3" : "audio/wav";
    const file = await uploadAudioToGemini(buf, mimeType, displayName);
    if (!file) return null;
    return { fileData: { mimeType: file.mimeType, fileUri: file.uri } };
  } catch {
    return null;
  }
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * Normaliza cues con tiempos absolutos del modelo: filtra componentes inválidos,
 * ordena, recorta a [0, durMs], evita solapes y rellena hasta cubrir el audio.
 */
function normalizeTimedCues(raw: unknown, durMs: number): TimelineCue[] {
  const arr = Array.isArray(raw) ? (raw as RawTimedCue[]) : [];
  const valid = arr
    .filter(c => typeof c?.componente === "string" && VOCAB.has(c.componente))
    .map(c => ({
      start_ms: Math.round(Number(c.start_ms)),
      end_ms: Math.round(Number(c.end_ms)),
      componente: c.componente as ComponenteScroll,
      props: asObj(c.props),
    }))
    .filter(c => Number.isFinite(c.start_ms) && Number.isFinite(c.end_ms))
    .sort((a, b) => a.start_ms - b.start_ms);

  if (valid.length === 0) return [];

  // Auto-detección de UNIDADES: si los tiempos parecen SEGUNDOS (mucho menores
  // que la duración en ms), reescalar ×1000 (el modelo a veces devuelve segundos).
  const maxRaw = Math.max(...valid.map(c => Math.max(c.start_ms, c.end_ms)));
  if (maxRaw > 0 && maxRaw <= durMs / 10) {
    for (const c of valid) {
      c.start_ms = Math.round(c.start_ms * 1000);
      c.end_ms = Math.round(c.end_ms * 1000);
    }
  }

  const cues: TimelineCue[] = [];
  let prevEnd = 0;
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    const start = Math.max(0, Math.min(c.start_ms, durMs - MIN_CUE_MS), prevEnd);
    const nextStart = i < valid.length - 1 ? valid[i + 1].start_ms : durMs;
    let end = Math.max(c.end_ms, start + MIN_CUE_MS);
    end = Math.min(end, durMs, Math.max(start + MIN_CUE_MS, nextStart));
    if (i === valid.length - 1) end = durMs;
    if (end <= start) continue;
    cues.push({ start_ms: start, end_ms: end, componente: c.componente, props: c.props });
    prevEnd = end;
  }
  if (cues.length) cues[0].start_ms = 0;
  return cues;
}

/** Reparte beats (con peso) proporcionalmente sobre la duración. Fallback por texto. */
function distributeByWeight(beats: RawBeat[], durMs: number): TimelineCue[] {
  const valid = beats.filter(
    (b): b is RawBeat & { componente: ComponenteScroll } =>
      typeof b?.componente === "string" && VOCAB.has(b.componente)
  );
  if (valid.length === 0) return [];
  const weights = valid.map(b => (typeof b.peso === "number" && b.peso > 0 ? Math.min(5, b.peso) : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const cues: TimelineCue[] = [];
  let cursor = 0;
  valid.forEach((b, i) => {
    const start = cursor;
    const end = i === valid.length - 1 ? durMs : Math.round(start + (weights[i] / total) * durMs);
    cursor = end;
    cues.push({ start_ms: start, end_ms: Math.max(end, start + 1), componente: b.componente, props: asObj(b.props) });
  });
  return cues;
}

function build(
  lesson: TimelineLessonInput,
  durMs: number,
  cues: TimelineCue[],
  motor: "multimodal" | "texto",
  transcript = ""
): LessonTimeline {
  return {
    leccion_id: lesson.nodeId,
    ruta_id: lesson.routeId,
    duracion_ms: durMs,
    aspect: "9:16",
    audio_url: lesson.audioUrl,
    cues,
    motor,
    transcript,
  };
}

/**
 * Genera el timeline (corto) de una lección. Intenta el Director MULTIMODAL
 * (escucha el audio → tiempos reales y contenido fiel); si el audio no se pudo
 * oír (transcript vacío o sin cues), cae al método por texto con los pasos de
 * ESTA lección (nunca con la síntesis global de la ruta). null si no hay material.
 */
export async function generateTimeline(
  lesson: TimelineLessonInput,
  sintesis: Sintesis
): Promise<LessonTimeline | null> {
  const durMs = Math.max(0, Math.round((lesson.audioDurationSeconds || 0) * 1000));
  if (durMs <= 0) return null;

  const contenido = stepsToText(lesson.steps);
  const conceptos = lessonConceptsText(sintesis, lesson.conceptIds);

  // ── 1) Director MULTIMODAL: Gemini escucha el audio (File API) ──
  const audioPart = await fetchAudioPart(lesson.audioUrl, `${lesson.routeId}_${lesson.nodeId}`);
  if (audioPart) {
    try {
      const prompt = `Eres el "Director" visual de Learn Factory. Tu ÚNICA fuente de verdad es el AUDIO adjunto (narración en español de una microlección). Tu trabajo NO es resumir el tema del curso: es MANIFESTAR EN PANTALLA, momento a momento, EXACTAMENTE lo que se DICE en ESTE audio, perfectamente sincronizado.

MÉTODO OBLIGATORIO:
1. Escucha el audio COMPLETO. Si NO puedes oírlo, devuelve "transcript": "" y "cues": [].
2. Recórrelo EN ORDEN y pártelo en segmentos consecutivos según las frases/ideas que se DICEN.
3. Por cada segmento crea UN cue cuyo visual representa la idea LITERAL de ESE segmento —lo que se oye entre su start_ms y su end_ms—, usando las MISMAS palabras clave que se pronuncian ahí.

REGLAS DE FIDELIDAD (lo más importante):
- El contenido de cada cue SALE de lo que se ESCUCHA en su intervalo. PROHIBIDO hablar del tema "en general", del curso, o de ideas que no se dicen en este audio.
- PROHIBIDO inventar datos, adelantar ideas que aún no se han dicho, o poner contenido genérico/decorativo.
- start_ms/end_ms = el momento EXACTO en que esa idea se narra.

${VOCAB_GUIDE}

PARÁMETROS:
- El audio dura ${durMs} ms. Los cues van EN ORDEN, sin solaparse, cubriendo de 0 a ${durMs} ms (el primero en 0; el último termina en ${durMs}).
- ⚠️ Tiempos en MILISEGUNDOS, NO en segundos. Ej.: del segundo 12 al 18 → start_ms: 12000, end_ms: 18000. Los valores deben acercarse a ${durMs} hacia el final.
- Apunta a ~${Math.max(MIN_BEATS, Math.min(MAX_BEATS, Math.round(lesson.audioDurationSeconds / 7)))} cues (más si hay densidad de ideas). "props": textos concisos en español fieles a lo dicho (títulos ≤6 palabras, puntos ≤8 palabras).
- "transcript": OBLIGATORIO. Escribe las primeras ~12 palabras EXACTAS (textuales) que oyes al inicio del audio. Es la prueba de que escuchaste; si está vacío, tu respuesta se descarta.
${conceptos ? `\nAPOYO ORTOGRÁFICO (solo para escribir bien nombres/términos de ESTA lección; NO es el contenido):\nLección: "${lesson.title}"\nTérminos:\n${conceptos}\n` : `\nLección: "${lesson.title}"\n`}
Devuelve SOLO este JSON, sin markdown:
{ "transcript": "...", "cues": [ { "start_ms": 0, "end_ms": 0, "componente": "TermCallout", "props": { } } ] }`;

      const model = getJsonModel(8192, 0.25); // temp baja = fiel al audio, sin deriva
      const result = await withTimeout(
        model.generateContent([audioPart, { text: prompt }]),
        AUDIO_TIMEOUT_MS,
        "Director multimodal del Modo Scroll"
      );
      const parsed = parseJsonResponse(result.response.text()) as { transcript?: string; cues?: RawTimedCue[] };
      const transcript = typeof parsed?.transcript === "string" ? parsed.transcript.trim() : "";
      const cues = normalizeTimedCues(parsed?.cues, durMs);
      // GUARD: sin transcript = el modelo NO oyó el audio → no guardamos un corto
      // que hablaría de otra cosa; mejor caer al fallback por texto de la lección.
      if (transcript.length >= 8 && cues.length > 0) {
        return build(lesson, durMs, cues, "multimodal", transcript);
      }
      console.warn(`[ScrollDirector] Multimodal sin transcript/cues (${lesson.routeId}/${lesson.nodeId}); el audio no se leyó → fallback por texto.`);
    } catch (e) {
      console.warn(`[ScrollDirector] Multimodal falló (${lesson.routeId}/${lesson.nodeId}): ${e instanceof Error ? e.message : e}. Fallback por texto.`);
    }
  }

  // ── 2) Fallback por TEXTO: usa los pasos de ESTA lección (nunca la síntesis
  // global de la ruta, para no derivar al tema del curso). ──
  if (!contenido.trim()) return null;
  const targetBeats = Math.max(MIN_BEATS, Math.min(MAX_BEATS, Math.round(lesson.audioDurationSeconds / 9)));
  const prompt = `Eres el "Director" visual de Learn Factory. Conviertes UNA microlección en un CORTO vertical: una secuencia de "beats" visuales fieles al contenido de ESTA lección (no del curso en general).

LECCIÓN: "${lesson.title}"
CONTENIDO DE LA LECCIÓN (tu ÚNICA fuente):
${contenido}
${conceptos ? `\nTérminos de esta lección (para ortografía):\n${conceptos}\n` : ""}
${VOCAB_GUIDE}

INSTRUCCIONES:
- Produce ${targetBeats} beats (±2) que recorran la lección EN ORDEN, del inicio al final.
- Cada beat: "componente" (uno EXACTO del vocabulario), "props" (datos concisos en español: títulos ≤6 palabras, puntos ≤8 palabras) y "peso" (entero 1-5 = duración relativa).
- Fiel al contenido de arriba. PROHIBIDO contenido genérico del tema. NO incluyas tiempos.

Devuelve SOLO este JSON, sin markdown:
{ "beats": [ { "componente": "VersusSplit", "props": { }, "peso": 3 } ] }`;

  const model = getJsonModel(8192, 0.3);
  const result = await withTimeout(model.generateContent([{ text: prompt }]), TEXT_TIMEOUT_MS, "Director del Modo Scroll");
  const parsed = parseJsonResponse(result.response.text()) as { beats?: RawBeat[] };
  const cues = distributeByWeight(Array.isArray(parsed?.beats) ? parsed.beats : [], durMs);
  if (cues.length === 0) return null;
  return build(lesson, durMs, cues, "texto");
}
