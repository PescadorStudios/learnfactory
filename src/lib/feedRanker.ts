// feedRanker — el cerebro del feed ALEATORIO del Modo Scroll.
// ----------------------------------------------------------------------------
// Servicio PURO y TESTEABLE: no toca BD ni red. Recibe candidatos + señales del
// usuario y devuelve el ORDEN del feed (nunca toca el contenido del corto). El
// "aleatorio" no es random plano: mezcla afinidad, exploración y repaso espaciado
// para que enganche como reels pero RETENGA (la ventaja sobre Instagram).
//
// Mezcla objetivo (ajustable por `weights`): ~60% afinidad de tema · ~25%
// exploración (temas nuevos adyacentes) · ~15% repaso espaciado (re-emerge
// conceptos ya vistos en el intervalo de la curva del olvido, REFORMULADOS: otro
// corto del mismo concepto). Penaliza cortos con bajo % de visionado global.

export interface RankCandidate {
  routeId: string;
  nodeId: string;
  topic: string;
  category: string;
  conceptIds: string[];
  /** Calidad histórica global del corto: % de visionado promedio (0..100). */
  globalAvgPct: number;
}

export interface UserSignal {
  routeId: string;
  nodeId: string;
  category: string;
  conceptIds: string[];
  pctVisto: number;
  liked: boolean;
  guardado: boolean;
  abrirRuta: boolean;
  /** epoch ms. */
  ts: number;
}

export type FeedBucket = "affinity" | "exploration" | "repaso";

export interface RankedCorto extends RankCandidate {
  score: number;
  bucket: FeedBucket;
}

export interface RankWeights {
  affinity: number;
  exploration: number;
  repaso: number;
}

export interface RankInput {
  candidates: RankCandidate[];
  history: UserSignal[];
  now?: number;
  /** Claves "routeId:nodeId" ya vistas en ESTA sesión (no se repiten salvo repaso). */
  sessionSeen?: Set<string>;
  /** Semilla para el jitter de exploración (determinista en tests). */
  seed?: number;
  weights?: RankWeights;
  limit?: number;
}

const DEFAULT_WEIGHTS: RankWeights = { affinity: 0.6, exploration: 0.25, repaso: 0.15 };
const DAY_MS = 86_400_000;
// Intervalos de la curva del olvido (días) según cuántas veces se vio el concepto.
const SPACED_INTERVALS_DAYS = [1, 3, 7, 16, 35, 70];

export const keyOf = (c: { routeId: string; nodeId: string }) => `${c.routeId}:${c.nodeId}`;

/** Peso de engagement de una señal (cuánto "le importó" al usuario ese corto). */
function engagementWeight(s: UserSignal): number {
  return Math.min(1, s.pctVisto / 100) + (s.liked ? 0.5 : 0) + (s.guardado ? 0.7 : 0) + (s.abrirRuta ? 1 : 0);
}

/** RNG determinista (mulberry32) para que la exploración sea reproducible en tests. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ConceptMemory {
  lastSeen: number;
  views: number;
}

/**
 * Ordena el feed. Determinista dado (input, seed). No muta `input`.
 */
export function rankFeed(input: RankInput): RankedCorto[] {
  const now = input.now ?? Date.now();
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const sessionSeen = input.sessionSeen ?? new Set<string>();
  const rng = makeRng(input.seed ?? 1);

  // ── Perfil del usuario a partir del historial ──
  const catAffinity = new Map<string, number>();
  const conceptMem = new Map<string, ConceptMemory>();
  const seenCortos = new Set<string>(); // cortos exactos ya vistos (para reformular)

  for (const s of input.history) {
    const w = engagementWeight(s);
    catAffinity.set(s.category, (catAffinity.get(s.category) ?? 0) + w);
    seenCortos.add(keyOf(s));
    for (const cid of s.conceptIds) {
      const m = conceptMem.get(cid);
      if (!m) conceptMem.set(cid, { lastSeen: s.ts, views: 1 });
      else { m.views += 1; if (s.ts > m.lastSeen) m.lastSeen = s.ts; }
    }
  }
  const maxCatAff = Math.max(1, ...catAffinity.values());
  const hasHistory = input.history.length > 0;

  // ── Puntuar cada candidato en los tres ejes ──
  const scored: RankedCorto[] = [];
  for (const c of input.candidates) {
    const k = keyOf(c);
    const alreadySeenCorto = seenCortos.has(k);

    // Calidad: penaliza cortos con bajo % de visionado histórico global.
    const quality = 0.4 + 0.6 * Math.min(1, Math.max(0, c.globalAvgPct) / 100);

    // AFINIDAD: cuánto encaja con los temas que el usuario ya consume.
    const affinity = (catAffinity.get(c.category) ?? 0) / maxCatAff;

    // EXPLORACIÓN: temas nuevos, mejor si son ADYACENTES (misma categoría que algo
    // consumido) que si son totalmente ajenos. Jitter para que no sea estático.
    const adjacency = catAffinity.has(c.category) ? 1 : 0.4;
    const novelty = affinity < 0.15 ? 1 : 0.2; // nuevo si casi no hay afinidad
    const exploration = novelty * adjacency * (0.7 + 0.3 * rng());

    // REPASO ESPACIADO: el corto cubre un concepto ya visto, está "vencido" según
    // la curva del olvido, y es OTRO corto (reformula, no repite el mismo).
    let repaso = 0;
    if (hasHistory && !alreadySeenCorto) {
      for (const cid of c.conceptIds) {
        const m = conceptMem.get(cid);
        if (!m) continue;
        const elapsedDays = (now - m.lastSeen) / DAY_MS;
        const interval = SPACED_INTERVALS_DAYS[Math.min(m.views - 1, SPACED_INTERVALS_DAYS.length - 1)];
        if (elapsedDays >= interval * 0.8) {
          // Dueness 0..1, saturando a 2× el intervalo.
          repaso = Math.max(repaso, Math.min(1, elapsedDays / (interval * 2)));
        }
      }
    }

    // Bucket primario = eje con mayor contribución ponderada.
    const aW = affinity * weights.affinity;
    const eW = exploration * weights.exploration;
    const rW = repaso * weights.repaso;
    let bucket: FeedBucket = "exploration";
    if (rW >= aW && rW >= eW && repaso > 0) bucket = "repaso";
    else if (aW >= eW) bucket = "affinity";

    // Sin historial: todo es "exploración" guiada por calidad.
    if (!hasHistory) bucket = "exploration";

    const score = (aW + eW + rW + (hasHistory ? 0 : 0.5 + 0.5 * rng())) * quality;
    scored.push({ ...c, score, bucket });
  }

  // ── Excluir lo ya visto en la sesión (salvo que toque por repaso) ──
  const eligible = scored.filter(c => c.bucket === "repaso" || !sessionSeen.has(keyOf(c)));

  // ── Construir el feed final respetando la mezcla objetivo ──
  const pools: Record<FeedBucket, RankedCorto[]> = {
    affinity: eligible.filter(c => c.bucket === "affinity").sort((a, b) => b.score - a.score),
    exploration: eligible.filter(c => c.bucket === "exploration").sort((a, b) => b.score - a.score),
    repaso: eligible.filter(c => c.bucket === "repaso").sort((a, b) => b.score - a.score),
  };

  const total = eligible.length;
  const limit = Math.min(input.limit ?? total, total);
  const order: FeedBucket[] = buildBucketSequence(weights, limit);

  const out: RankedCorto[] = [];
  const used = new Set<string>();
  const drawFrom = (b: FeedBucket): RankedCorto | null => {
    while (pools[b].length) {
      const next = pools[b].shift()!;
      if (!used.has(keyOf(next))) return next;
    }
    return null;
  };
  const fallbackOrder: FeedBucket[] = ["affinity", "exploration", "repaso"];
  for (const b of order) {
    let pick = drawFrom(b);
    if (!pick) for (const fb of fallbackOrder) { pick = drawFrom(fb); if (pick) break; }
    if (!pick) break;
    used.add(keyOf(pick));
    out.push(pick);
  }
  return out;
}

/** Secuencia de buckets que aproxima las proporciones objetivo a lo largo de `n`. */
function buildBucketSequence(weights: RankWeights, n: number): FeedBucket[] {
  const sum = weights.affinity + weights.exploration + weights.repaso || 1;
  const targets: Record<FeedBucket, number> = {
    affinity: weights.affinity / sum,
    exploration: weights.exploration / sum,
    repaso: weights.repaso / sum,
  };
  const counts: Record<FeedBucket, number> = { affinity: 0, exploration: 0, repaso: 0 };
  const buckets: FeedBucket[] = ["affinity", "exploration", "repaso"];
  const seq: FeedBucket[] = [];
  for (let i = 0; i < n; i++) {
    // Elige el bucket cuya proporción actual está más por debajo de su objetivo.
    let best: FeedBucket = "affinity";
    let bestDeficit = -Infinity;
    for (const b of buckets) {
      const current = i === 0 ? 0 : counts[b] / i;
      const deficit = targets[b] - current;
      if (deficit > bestDeficit) { bestDeficit = deficit; best = b; }
    }
    counts[best]++;
    seq.push(best);
  }
  return seq;
}
