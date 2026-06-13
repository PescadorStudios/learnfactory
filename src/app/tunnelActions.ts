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
import { getMyRoutes, getRoute, getRouteAudioStations, type RouteAudioStation } from "./routeActions";
import { getLibrary } from "./socialActions";
import { categoryLabel } from "@/lib/types";
import type { Sintesis } from "@/lib/types";
import type {
  AudioLessonChallenge,
  ImpostorChallenge,
  ImpostorFact,
  Lesson,
  LessonSummary,
  Pod,
  TrapSegment,
  TrapSubtitlesChallenge,
} from "@/tunnel/types/contract";

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

// ============================================================================
// CATÁLOGO Y LECCIONES REALES (el seam LessonProvider, lado servidor)
// ----------------------------------------------------------------------------
// El motor del túnel es agnóstico al contenido; aquí convertimos rutas REALES
// de Learn Factory en lecciones jugables SIN IA y de forma DETERMINISTA:
//
//   • Verdad   →  "Concepto: definición"  (de sintesis.conceptos)
//   • Mentira  →  "Concepto A: definición de OTRO concepto"  (emparejado mal)
//
// El emparejamiento erróneo es fiable (siempre falso), plausible (suena a
// definición de verdad) y no necesita modelo generativo. Como NO usamos azar,
// el texto narrado es estable y la caché de Charon (clave = texto) se reutiliza.
//
// La categoría viaja DENTRO del id de la lección (`route:{categoria}:{routeId}`)
// para que listar el catálogo no exija una segunda consulta por ruta: el nicho
// (color/etiqueta del lobby) sale gratis del propio id.
// ============================================================================

const LF_PREFIX = "route:"; // prefijo del id de lección real (vs. ids del demo)
const SEG_SECS = 4.4; // cadencia de subtítulos (las definiciones son más largas)
const MAX_LINE = 150; // recorte por frase: natural al narrar y bajo MAX_TTS_CHARS
const MAX_PODS = 6; // estaciones por ruta (no saturar el viaje)
const MAX_CATALOG = 24; // tarjetas en el lobby (mías + biblioteca, deduplicadas)

/** Concepto normalizado para sintetizar retos. */
interface Fact {
  subject: string; // nombre del concepto
  truth: string; // su definición
  cita?: string; // cita textual (recompensa bonita si existe)
}

/** Recorta a longitud agradable para narrar, cortando en frontera de palabra. */
function clip(s: string, max = MAX_LINE): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:]+$/, "") + "…";
}

function clampPods(n: number): number {
  return Math.max(2, Math.min(MAX_PODS, n || 3));
}

/** Frase verdadera "Nombre: definición". */
function trueLine(f: Fact): string {
  return clip(`${f.subject}: ${f.truth}`);
}

/** Frase falsa plausible: el nombre de un concepto con la definición de OTRO. */
function falseLine(f: Fact, other: Fact): string {
  return clip(`${f.subject}: ${other.truth}`);
}

/** Otro concepto cuya definición difiere de la de `f` (para mentir sin empatar). */
function differentFrom(f: Fact, pool: Fact[]): Fact | null {
  return pool.find((p) => p !== f && p.truth !== f.truth) ?? null;
}

function factsFromSintesis(s: Sintesis | null | undefined): Fact[] {
  const out: Fact[] = [];
  for (const c of s?.conceptos ?? []) {
    const subject = (c?.nombre ?? "").trim();
    const truth = (c?.definicion ?? "").trim();
    if (subject && truth) {
      out.push({ subject, truth, cita: (c?.citaTextual ?? "").trim() || undefined });
    }
  }
  return out;
}

/** Pod "Subtítulos Trampa": el audio narra la verdad (`spoken`), el texto miente. */
function trapPod(idx: number, group: Fact[], pool: Fact[]): Pod {
  const segments: TrapSegment[] = group.map((f, i) => {
    const start = +(i * SEG_SECS).toFixed(2);
    const end = +((i + 1) * SEG_SECS).toFixed(2);
    // Alterna: los impares mienten (garantiza ≥1 trampa si el grupo tiene ≥2).
    const wantsTrap = i % 2 === 1;
    const liar = wantsTrap ? differentFrom(f, pool) : null;
    if (liar) {
      // Se MUESTRA la mentira; se NARRA la verdad → cazable aunque el tema sea nuevo.
      return { start, end, text: falseLine(f, liar), isTrap: true, spoken: trueLine(f) };
    }
    return { start, end, text: trueLine(f), isTrap: false };
  });
  // Seguro: si por empates no quedó ninguna trampa, fuerza una.
  if (!segments.some((s) => s.isTrap)) {
    const j = segments.length >= 2 ? 1 : 0;
    const liar = differentFrom(group[j], pool);
    if (liar) {
      segments[j] = { ...segments[j], text: falseLine(group[j], liar), isTrap: true, spoken: trueLine(group[j]) };
    }
  }
  const challenge: TrapSubtitlesChallenge = { type: "trap_subtitles", audioUrl: "", segments };
  return {
    id: `p${idx}`,
    title: clip(group[0]?.subject ?? "Repaso", 48),
    challenge,
    reward: clip(group[0]?.cita || trueLine(group[0])),
  };
}

/** Pod "Impostor": 3 frases, exactamente 1 falsa (definición intercambiada). */
function impostorPod(idx: number, group: Fact[], pool: Fact[]): Pod {
  // Toma hasta 3 conceptos distintos; rellena del pool si el grupo es corto.
  const picks: Fact[] = [...group];
  for (const f of pool) {
    if (picks.length >= 3) break;
    if (!picks.includes(f)) picks.push(f);
  }
  const trio = picks.slice(0, 3);
  const liarIdx = trio.length - 1; // la última miente (antes de rotar)
  const built: ImpostorFact[] = trio.map((f, i) => {
    if (i === liarIdx) {
      const liar = differentFrom(f, pool);
      return liar
        ? { text: falseLine(f, liar), isFalse: true }
        : { text: trueLine(f), isFalse: false };
    }
    return { text: trueLine(f), isFalse: false };
  });
  // Si no se pudo mentir (pool empatado), fuerza la última como falsa con la 1ª def.
  if (!built.some((b) => b.isFalse) && trio.length >= 2) {
    built[liarIdx] = { text: falseLine(trio[liarIdx], trio[0]), isFalse: true };
  }
  // Rotación determinista: la falsa no cae siempre al final, pero sin azar.
  const rot = idx % built.length;
  const facts = built.slice(rot).concat(built.slice(0, rot));
  const challenge: ImpostorChallenge = { type: "impostor", timeoutMs: 9000, facts };
  return {
    id: `p${idx}`,
    title: clip(trio[0]?.subject ?? "Impostor", 48),
    challenge,
    reward: clip(trio[0]?.cita || trueLine(trio[0])),
  };
}

/** Pod degenerado (ruta sin conceptos) para no romper el ensamblado del rail. */
function fallbackPod(topic: string, description: string | null): Pod {
  const t1 = clip(`Esta ruta trata sobre ${topic}.`);
  const t2 = clip(description || `Recorre el túnel para repasar ${topic}.`);
  const lie = clip(`${topic} no aparece en esta ruta.`);
  const segments: TrapSegment[] = [
    { start: 0, end: SEG_SECS, text: t1, isTrap: false },
    { start: SEG_SECS, end: 2 * SEG_SECS, text: lie, isTrap: true, spoken: t1 },
    { start: 2 * SEG_SECS, end: 3 * SEG_SECS, text: t2, isTrap: false },
  ];
  return {
    id: "p1",
    title: clip(topic, 40),
    challenge: { type: "trap_subtitles", audioUrl: "", segments },
    reward: t2,
  };
}

/**
 * Pod "Lección de audio": una estación que reproduce la narración continua REAL
 * del nodo (un solo WAV) con su mecánica de atención. La voz ya no se sintetiza
 * por segmento — se escucha entera, anclada al reloj del propio audio.
 * El `id` del pod ES el id del nodo: estable y único dentro de la ruta.
 */
function audioLessonPod(st: RouteAudioStation): Pod {
  const challenge: AudioLessonChallenge = {
    type: "audio_lesson",
    audioUrl: st.audioUrl,
    durationSeconds: st.durationSeconds,
    attention: st.attention,
  };
  return { id: st.nodeId, title: clip(st.title, 64), challenge, reward: clip(st.title, 80) };
}

/** Ensambla los pods de una ruta alternando Trampa (grupos de 4) e Impostor (3). */
function buildPods(facts: Fact[], s: Sintesis | null | undefined): Pod[] {
  const pods: Pod[] = [];

  if (facts.length < 2) {
    // Casi vacío: un único impostor con tesis + advertencias (verdades) y 1 mentira.
    const truths = [s?.tesisGlobal, ...(s?.advertenciasDeContexto ?? [])]
      .map((t) => clip((t ?? "").trim()))
      .filter(Boolean);
    if (facts.length === 1) truths.unshift(trueLine(facts[0]));
    if (truths.length < 2) return pods; // nada utilizable
    const built: ImpostorFact[] = truths.slice(0, 2).map((text) => ({ text, isFalse: false }));
    // Mentira mínima fiable: niega explícitamente la primera verdad.
    built.push({ text: clip(`Mito: lo contrario de "${truths[0]}"`), isFalse: true });
    pods.push({
      id: "p1",
      title: "Idea central",
      challenge: { type: "impostor", timeoutMs: 9000, facts: built },
      reward: truths[0],
    });
    return pods;
  }

  let i = 0;
  let n = 1;
  let trapTurn = true;
  while (i < facts.length && pods.length < MAX_PODS) {
    const size = trapTurn ? 4 : 3;
    const group = facts.slice(i, i + size);
    i += group.length;
    if (trapTurn && group.length >= 2) {
      pods.push(trapPod(n++, group, facts));
    } else {
      pods.push(impostorPod(n++, group, facts));
    }
    trapTurn = !trapTurn;
  }
  return pods;
}

/**
 * Catálogo del túnel: rutas REALES jugables. Combina TUS rutas listas con la
 * biblioteca pública (deduplicadas por id), acotado a MAX_CATALOG tarjetas.
 * Cada entrada lleva la categoría embebida en el id para no consultar de más.
 */
export async function getTunnelCatalog(token: string): Promise<LessonSummary[]> {
  const [mine, sections] = await Promise.all([
    getMyRoutes(token).catch(() => []),
    getLibrary(token).catch(() => []),
  ]);

  const byId = new Map<string, LessonSummary>();
  const add = (
    routeId: string,
    topic: string,
    category: string,
    description: string | null,
    estPods: number
  ) => {
    if (byId.has(routeId) || byId.size >= MAX_CATALOG) return;
    byId.set(routeId, {
      id: `${LF_PREFIX}${category}:${routeId}`,
      title: topic,
      niche: categoryLabel(category),
      blurb: clip(description || "Una ruta de Learn Factory, ahora como viaje.", 90),
      estPods,
    });
  };

  // Mis rutas primero (pocas, relevantes) — solo las listas y con nodos.
  for (const r of mine) {
    if (r.status !== "ready" || r.totalNodes <= 0) continue;
    add(r.id, r.topic, r.category, r.description, clampPods(Math.round(r.totalNodes / 2)));
  }
  // Luego rellena con la biblioteca pública hasta el tope.
  for (const sec of sections) {
    for (const c of sec.routes) add(c.id, c.topic, c.category, c.description, 4);
  }
  return [...byId.values()];
}

/**
 * Carga una ruta real como lección jugable. Devuelve `null` si el id no es de
 * una ruta (lo maneja el provider) o si la ruta no es accesible para el viewer.
 */
export async function getTunnelLesson(
  token: string,
  lessonId: string
): Promise<Lesson | null> {
  if (!lessonId.startsWith(LF_PREFIX)) return null;
  const rest = lessonId.slice(LF_PREFIX.length); // "{categoria}:{routeId}"
  const sep = rest.indexOf(":");
  const category = sep >= 0 ? rest.slice(0, sep) : "otros";
  const routeId = sep >= 0 ? rest.slice(sep + 1) : rest;

  // Camino preferido: lecciones de audio REALES (voz continua + las 3 mecánicas).
  // Cada nodo con su WAV pregenerado y sus cues se vuelve una estación jugable.
  const real = await getRouteAudioStations(token, routeId);
  if (real && real.stations.length > 0) {
    const pods = real.stations.slice(0, MAX_PODS).map(audioLessonPod);
    return { id: lessonId, title: real.topic, niche: categoryLabel(category), pods };
  }

  // Fallback: ruta sin audios listos (o lección antigua) → retos sintetizados de
  // forma determinista a partir de los conceptos (sin IA; caché de voz estable).
  const route = await getRoute(token, routeId);
  if (!route) return null;

  const facts = factsFromSintesis(route.sintesis);
  const pods = buildPods(facts, route.sintesis);
  if (pods.length === 0) pods.push(fallbackPod(route.topic, route.description ?? null));

  return { id: lessonId, title: route.topic, niche: categoryLabel(category), pods };
}
