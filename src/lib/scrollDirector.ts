// El "Director" del Modo Scroll. SOLO servidor.
// Una pasada de Gemini (offline, UNA vez por lección) que convierte el contenido
// de una lección en un timeline declarativo de "cues": cada cue elige un
// componente del VOCABULARIO CERRADO y lo codifica con props. Doble codificación
// (Paivio): cada cue representa visualmente el MISMO significado que narra el
// audio, nunca decora.
//
// El Director devuelve BEATS ordenados con un PESO relativo de duración; los
// timestamps absolutos (start_ms/end_ms) los calcula este módulo repartiendo
// audio_duration proporcionalmente. Así la sincronización a nivel de segmento es
// robusta sin depender de que el LLM haga aritmética de milisegundos.
import "server-only";
import { getJsonModel, parseJsonResponse, sintesisBlock } from "@/lib/generation";
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
const GEN_TIMEOUT_MS = 60_000;

export interface TimelineLessonInput {
  routeId: string;
  nodeId: string;
  title: string;
  /** Pasos de la lección (fuente semántica del significado). */
  steps: LessonStep[] | null;
  /** ids de conceptos de la síntesis que cubre la lección. */
  conceptIds: string[];
  audioUrl: string;
  audioDurationSeconds: number;
}

interface RawBeat {
  componente?: string;
  props?: Record<string, unknown>;
  peso?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} agotó el tiempo (${ms}ms)`)), ms)),
  ]);
}

/** Texto legible de los pasos de la lección para alimentar al Director. */
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

REGLA DE DOBLE CODIFICACIÓN (obligatoria): cada beat debe CODIFICAR el significado del fragmento, no decorarlo.
- una comparación → VersusSplit · un proceso → StepFlow · una secuencia temporal → Timeline
- una jerarquía/relaciones → NodeGraph · una cantidad → Counter · un término → TermCallout
- una idea-lista → BuildList · una cita → QuoteBeat · una proporción/avance → ProgressBar · una idea ancla → KeyImage
PROHIBIDO el visual decorativo que no representa la idea.`;

/**
 * Genera el timeline declarativo (corto) de una lección. Devuelve null si no hay
 * suficiente material o si el modelo no produjo beats válidos.
 */
export async function generateTimeline(
  lesson: TimelineLessonInput,
  sintesis: Sintesis
): Promise<LessonTimeline | null> {
  const durMs = Math.max(0, Math.round((lesson.audioDurationSeconds || 0) * 1000));
  if (durMs <= 0) return null;

  const contenido = stepsToText(lesson.steps);
  if (!contenido.trim()) return null;

  // ~1 beat por cada 9 s de audio, acotado a [MIN_BEATS, MAX_BEATS].
  const targetBeats = Math.max(MIN_BEATS, Math.min(MAX_BEATS, Math.round(lesson.audioDurationSeconds / 9)));

  const prompt = `Eres el "Director" visual de Learn Factory. Conviertes una lección en un CORTO vertical estilo reel: una secuencia de "beats" visuales que se muestran sincronizados con el audio narrado. Tu trabajo es decidir, para cada beat, QUÉ componente del vocabulario codifica mejor esa idea y con qué datos.

${sintesisBlock(sintesis)}

LECCIÓN: "${lesson.title}"
CONTENIDO DE LA LECCIÓN (tu materia prima para los beats):
${contenido}

${VOCAB_GUIDE}

INSTRUCCIONES:
- Produce ${targetBeats} beats (±2) que recorran la lección EN ORDEN, del inicio al final.
- Cada beat: "componente" (uno EXACTO del vocabulario), "props" (solo los datos que ese componente necesita, en español, concisos: títulos ≤6 palabras, puntos ≤8 palabras) y "peso" (entero 1-5 = duración relativa del beat; usa más peso en ideas centrales).
- Varía los componentes según el tipo de idea (no repitas siempre el mismo). Sé fiel a la síntesis: no inventes datos.
- NO incluyas tiempos ni milisegundos: solo el orden y el peso.

Devuelve SOLO este JSON, sin markdown ni texto extra:
{ "beats": [ { "componente": "VersusSplit", "props": { }, "peso": 3 } ] }`;

  const model = getJsonModel(8192);
  const result = await withTimeout(model.generateContent([{ text: prompt }]), GEN_TIMEOUT_MS, "Director del Modo Scroll");
  const parsed = parseJsonResponse(result.response.text()) as { beats?: RawBeat[] };

  const rawBeats = Array.isArray(parsed?.beats) ? parsed.beats : [];
  // Quedarse solo con beats cuyo componente está en el vocabulario cerrado.
  const valid = rawBeats.filter(
    (b): b is RawBeat & { componente: ComponenteScroll } =>
      typeof b?.componente === "string" && VOCAB.has(b.componente)
  );
  if (valid.length === 0) return null;

  // Repartir la duración del audio proporcionalmente al peso de cada beat.
  const weights = valid.map(b => (typeof b.peso === "number" && b.peso > 0 ? Math.min(5, b.peso) : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const cues: TimelineCue[] = [];
  let cursor = 0;
  valid.forEach((b, i) => {
    const start = cursor;
    // El último beat cierra exactamente en durMs (evita huecos por redondeo).
    const end = i === valid.length - 1 ? durMs : Math.round(start + (weights[i] / totalWeight) * durMs);
    cursor = end;
    cues.push({
      start_ms: start,
      end_ms: Math.max(end, start + 1),
      componente: b.componente,
      props: b.props && typeof b.props === "object" ? b.props : {},
    });
  });

  return {
    leccion_id: lesson.nodeId,
    ruta_id: lesson.routeId,
    duracion_ms: durMs,
    aspect: "9:16",
    audio_url: lesson.audioUrl,
    cues,
  };
}
