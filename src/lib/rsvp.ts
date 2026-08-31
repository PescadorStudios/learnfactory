// ──────────────────────────────────────────────────
//  MODO LECTURA VELOZ — motor RSVP puro
// ──────────────────────────────────────────────────
// RSVP (Rapid Serial Visual Presentation): el texto no se recorre con la vista,
// se proyecta en un punto fijo. Cada palabra lleva su ORP (Optimal Recognition
// Point) —la letra que el ojo busca para reconocerla— pintada en rojo y anclada
// SIEMPRE en la misma columna, así no hay una sola sacada ocular.
//
// Este módulo no toca la base de datos, ni React, ni el DOM: son funciones puras
// para poder testearlas en aislamiento (src/lib/rsvp.test.ts). Mismo reparto que
// src/lib/sessionBudget.ts ↔ src/lib/sessionGate.ts.
//
// CONVENCIÓN IMPORTANTE: `tokenizeWords` devuelve UNA entrada por palabra —eso
// es lo que hace que `cursor_word` sea un cursor estable—, y marca el fin de
// párrafo con un "\n" pegado al final de la palabra. `buildChunks` lo lee y lo
// quita antes de pintar. Sin ese marcador se perdería la pausa más larga (la de
// párrafo), que es justo la que da respiro al lector.

import { LECTURA_SECTION_WORDS } from "./sessionBudget";

export type StopKind = "none" | "comma" | "sentence" | "paragraph";

export interface RsvpChunk {
  /** Lo que se pinta. Con chunkSize > 1, palabras unidas por espacio. */
  text: string;
  /** Índice (en code points) de la letra ORP dentro de `text`. */
  orp: number;
  /** Índice de la PRIMERA palabra del chunk en el documento. Cursor estable. */
  wordIndex: number;
  /** Cuántas palabras trae. */
  words: number;
  /** Multiplicador de duración precalculado (1 = base). */
  weight: number;
  /** Puntuación de cierre, para la pausa dinámica. */
  stop: StopKind;
}

export interface RsvpOptions {
  /** Palabras por chunk (1..4). */
  chunkSize: number;
  /** Pausas extra en coma / punto / párrafo. */
  dynamicPauses: boolean;
  /** Más tiempo a las palabras largas. */
  longWordBoost: boolean;
}

export const RSVP_DEFAULTS: RsvpOptions = {
  chunkSize: 1,
  dynamicPauses: true,
  longWordBoost: true,
};

export const WPM_MIN = 100;
/**
 * Tope duro. A chunk 1 son ~16 cambios por segundo: por encima el texto deja de
 * ser legible y el riesgo fotosensible deja de ser hipotético.
 */
export const WPM_MAX = 1000;
export const WPM_STEP = 25;
/** Presets del ecualizador (el onboarding sugiere empezar en 300). */
export const WPM_PRESETS = [250, 350, 500, 700] as const;

/**
 * Topes de importación. `next.config.ts` permite 12 mb de body, pero Vercel
 * corta el cuerpo de una función serverless en ~4.5 MB: 500 000 caracteres en
 * español son ~550 kB, con margen de sobra. El documento se sube por partes.
 */
export const MAX_PART_CHARS = 500_000;
/** ~250 000 palabras ≈ una novela larga. */
export const MAX_DOC_CHARS = 1_500_000;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** Mínimo de palabras para dar un PDF por legible (si no, es un escaneo). */
export const MIN_USABLE_WORDS = 50;

const PAUSE: Record<StopKind, number> = {
  none: 0,
  comma: 0.35,
  sentence: 0.75,
  paragraph: 1.2,
};

/**
 * Palabras funcionales cortas: el ojo no las lee, las reconoce de un vistazo, y
 * darles el mismo tiempo que a un sustantivo rompe el ritmo.
 */
const FUNCTION_WORDS = new Set([
  "el", "la", "los", "las", "un", "de", "del", "a", "al", "y", "o", "u", "e",
  "en", "es", "se", "su", "sus", "lo", "le", "les", "me", "te", "nos", "no",
  "ni", "si", "sí", "que", "por", "con", "más", "muy", "ya", "ha", "he", "son",
  "ser", "fue", "era", "the", "of", "to", "in", "is", "it", "as", "at", "on",
]);

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Acota el WPM. Un 0, un negativo o un NaN NO pueden producir Infinity. */
export function clampWpm(wpm: number): number {
  return Math.round(clamp(wpm, WPM_MIN, WPM_MAX));
}

// ── Normalización ───────────────────────────────────────────────────────────

/**
 * Limpia texto crudo de un PDF o del portapapeles. IDEMPOTENTE: aplicarlo dos
 * veces da el mismo resultado (lo garantiza un test).
 *
 * El paso clave es el de los saltos de línea: en un PDF CADA línea acaba en
 * "\n". Si se dejaran, cada una dispararía la pausa larga de párrafo y el ritmo
 * sería un desastre. Solo el "\n\n" sobrevive como párrafo de verdad.
 */
export function normalizeText(raw: string): string {
  if (!raw) return "";
  return (
    raw
      // NFC: sin esto, un texto en NFD tiene la tilde como carácter aparte y el
      // pivote se desplazaría (y un slice partiría el carácter compuesto).
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      // Guion suave: invisible, pero cuenta como carácter y rompe el ORP.
      .replace(/­/g, "")
      // Corte de palabra a final de línea. Solo si tras el salto va MINÚSCULA:
      // "teórico-\nPráctico" es un compuesto de verdad y se conserva.
      .replace(/(\p{Ll})[-‐]\n[ \t]*(\p{Ll})/gu, "$1$2")
      // Folios: líneas que son solo un número. Se llevan SU PROPIO salto por
      // delante (por eso el \n va dentro del match y no un $ multilínea), así el
      // párrafo sigue de corrido en vez de partirse en dos.
      .replace(/^[ \t]*\d{1,4}[ \t]*(?:\n|$)/gmu, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      // Salto SIMPLE (el de fin de línea del PDF) → espacio.
      .replace(/(?<!\n)\n(?!\n)/g, " ")
      .replace(/[ \t]*\n\n[ \t]*/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

/**
 * Palabras del documento. El índice del array ES el cursor que se persiste.
 * La última palabra de cada párrafo lleva un "\n" pegado (ver cabecera).
 */
export function tokenizeWords(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split("\n\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    words[words.length - 1] += "\n";
    out.push(...words);
  }
  return out;
}

/** Quita el marcador de fin de párrafo. */
function bare(word: string): string {
  return word.endsWith("\n") ? word.slice(0, -1) : word;
}

// ── ORP ─────────────────────────────────────────────────────────────────────

/**
 * Punto óptimo de reconocimiento de una palabra suelta.
 * Reproduce la tabla clásica: 1 letra → 0, 2-5 → 1, 6-9 → 2, 10-13 → 3, 14+ → 4.
 *
 * Se cuenta en CODE POINTS, no en unidades UTF-16, y se ignora la puntuación
 * («, ¿, comillas) para que el pivote caiga en la letra y no en un signo. El
 * offset de la puntuación inicial sí se suma, porque el índice devuelto es
 * relativo a la cadena completa que se va a pintar.
 */
export function orpIndex(word: string): number {
  const w = bare(word);
  if (!w) return 0;
  const core = w.replace(/^[^\p{L}\p{N}]+/u, "");
  const lead = [...w].length - [...core].length;
  const len = [...core.replace(/[^\p{L}\p{N}]+$/u, "")].length;
  if (len <= 1) return Math.min(lead, Math.max(0, [...w].length - 1));
  return lead + Math.min(4, Math.ceil((len - 1) / 4));
}

function stopOf(word: string): StopKind {
  if (word.endsWith("\n")) return "paragraph";
  const w = word.replace(/[»”’")\]]+$/u, "");
  if (/[.!?…:;]$/u.test(w)) return "sentence";
  if (/,$/u.test(w)) return "comma";
  return "none";
}

function letterCount(word: string): number {
  return [...bare(word).replace(/[^\p{L}\p{N}]/gu, "")].length;
}

function isFunctionWord(word: string): boolean {
  const w = bare(word)
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
  return w.length <= 3 && FUNCTION_WORDS.has(w);
}

// ── Chunks ──────────────────────────────────────────────────────────────────

/**
 * Palabras → chunks reproducibles. O(n).
 *
 * Un chunk NUNCA cruza un fin de frase ni de párrafo, aunque quepan más
 * palabras: leer "punto. Empieza" de un golpe destruye la señal de que ahí
 * terminó una idea.
 *
 * Todo lo caro (longitud, puntuación, palabras funcionales) se precalcula aquí
 * en `weight`, para que mover el slider de velocidad sea instantáneo y no haya
 * que volver a tokenizar el libro entero.
 */
export function buildChunks(words: string[], opts?: Partial<RsvpOptions>): RsvpChunk[] {
  const o: RsvpOptions = { ...RSVP_DEFAULTS, ...opts };
  const size = Math.round(clamp(o.chunkSize, 1, 4));
  const chunks: RsvpChunk[] = [];

  let i = 0;
  while (i < words.length) {
    const group: string[] = [];
    let stop: StopKind = "none";
    while (group.length < size && i + group.length < words.length) {
      const w = words[i + group.length];
      group.push(w);
      stop = stopOf(w);
      if (stop === "sentence" || stop === "paragraph") break;
    }

    const parts = group.map(bare);
    const text = parts.join(" ");

    // Pivote sobre la palabra CENTRAL del grupo, más su desplazamiento dentro
    // de la cadena: así el ancla sigue cayendo cerca del centro visual.
    const pivotWord = Math.floor((parts.length - 1) / 2);
    let offset = 0;
    for (let k = 0; k < pivotWord; k++) offset += [...parts[k]].length + 1;
    const orp = offset + orpIndex(parts[pivotWord]);

    const maxLetters = group.reduce((m, w) => Math.max(m, letterCount(w)), 0);
    let weight = 1 + (o.longWordBoost ? 0.04 * Math.max(0, maxLetters - 6) : 0);
    if (group.length === 1 && isFunctionWord(group[0])) weight *= 0.85;
    if (o.dynamicPauses) weight += PAUSE[stop];

    chunks.push({ text, orp, wordIndex: i, words: group.length, weight, stop });
    i += group.length;
  }

  return chunks;
}

/** Cuánto dura un chunk en pantalla. O(1): el peso ya viene calculado. */
export function chunkDurationMs(chunk: RsvpChunk, wpm: number): number {
  const base = 60_000 / clampWpm(wpm);
  const ms = base * chunk.words * chunk.weight;
  // Suelo de 40 ms: por debajo el navegador no alcanza a pintar y el chunk se
  // pierde. Techo de 3 s: ninguna pausa debe parecer que la app se colgó.
  return Math.min(3000, Math.max(40, ms));
}

/** Chunk que contiene una palabra dada. Búsqueda binaria. */
export function chunkIndexForWord(chunks: RsvpChunk[], wordIndex: number): number {
  if (!chunks.length) return 0;
  const target = Math.max(0, Math.floor(wordIndex) || 0);
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (chunks[mid].wordIndex <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── Secciones (la unidad del muro de sesiones) ──────────────────────────────

export function sectionOf(wordIndex: number, sectionWords: number = LECTURA_SECTION_WORDS): number {
  const w = Math.max(0, Math.floor(wordIndex) || 0);
  return Math.floor(w / Math.max(1, sectionWords));
}

export function sectionCount(totalWords: number, sectionWords: number = LECTURA_SECTION_WORDS): number {
  const t = Math.max(0, Math.floor(totalWords) || 0);
  return Math.ceil(t / Math.max(1, sectionWords));
}

// ── Navegación por frase ────────────────────────────────────────────────────

function isBreak(s: StopKind): boolean {
  return s === "sentence" || s === "paragraph";
}

/** Índice de chunk donde empieza la frase que contiene `i`. */
function sentenceStart(chunks: RsvpChunk[], i: number): number {
  let j = i - 1;
  while (j >= 0 && !isBreak(chunks[j].stop)) j--;
  return j + 1;
}

/**
 * Retroceder: al inicio de ESTA frase; si ya estabas ahí, a la anterior. Es lo
 * que se necesita cuando te perdiste — retroceder una palabra no sirve de nada.
 */
export function previousSentenceWord(chunks: RsvpChunk[], chunkIdx: number): number {
  if (!chunks.length) return 0;
  const i = Math.round(clamp(chunkIdx, 0, chunks.length - 1));
  const s = sentenceStart(chunks, i);
  if (s < i) return chunks[s].wordIndex;
  return chunks[Math.max(0, sentenceStart(chunks, s - 1))].wordIndex;
}

/** Avanzar a la primera palabra de la frase siguiente. */
export function nextSentenceWord(chunks: RsvpChunk[], chunkIdx: number): number {
  if (!chunks.length) return 0;
  const i = Math.round(clamp(chunkIdx, 0, chunks.length - 1));
  for (let j = i; j < chunks.length; j++) {
    if (isBreak(chunks[j].stop)) {
      const next = Math.min(j + 1, chunks.length - 1);
      return chunks[next].wordIndex;
    }
  }
  return chunks[chunks.length - 1].wordIndex;
}

/** Minutos restantes estimados, para la etiqueta del ecualizador. */
export function estimateMinutes(wordsLeft: number, wpm: number): number {
  const left = Math.max(0, Math.floor(wordsLeft) || 0);
  if (left === 0) return 0;
  return Math.max(1, Math.ceil(left / clampWpm(wpm)));
}

/**
 * ¿El texto extraído de un PDF sirve? Un escaneo sin capa de texto devuelve "" o
 * un puñado de caracteres de control. No se ofrece OCR a propósito: sería coste
 * e IA, justo lo que este modo evita.
 */
export function looksLikeScannedPdf(text: string): boolean {
  const clean = text.trim();
  if (!clean) return true;
  const words = clean.split(/\s+/).filter(Boolean).length;
  if (words < MIN_USABLE_WORDS) return true;
  const junk = (clean.match(/[^\p{L}\p{N}\p{P}\p{Zs}\n]/gu) || []).length;
  return junk / clean.length > 0.3;
}
