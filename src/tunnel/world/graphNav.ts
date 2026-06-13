// ============================================================================
// NAVEGACIÓN DEL GRAFO — Capa 0 (puro, agnóstico). El vuelo libre hace que la
// cámara CAMINE el grafo arista por arista: aquí están las estructuras (adyacen-
// cia + longitudes en mundo) y la decisión de "¿qué arista sigue?" según el rumbo
// (steer) del piloto. No conoce el contenido: solo nodos, aristas y carril (lane).
// ============================================================================

import * as THREE from "three";
import type { Rail, RailEdge, RailNode } from "../types/rail";

export interface NavGraph {
  nodeById: Map<string, RailNode>;
  pos: Map<string, THREE.Vector3>;
  edgeById: Map<string, RailEdge>;
  /** Aristas que SALEN de un nodo (e.from === id): continúan "hacia adelante". */
  out: Map<string, RailEdge[]>;
  /** Aristas que ENTRAN a un nodo (e.to === id): continúan "hacia atrás". */
  inn: Map<string, RailEdge[]>;
  /** Longitud en unidades de mundo de cada arista. */
  len: Map<string, number>;
  startId: string;
  stations: RailNode[];
}

const EPS = 0.001;

function push(m: Map<string, RailEdge[]>, k: string, v: RailEdge) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

export function buildNavGraph(rail: Rail): NavGraph {
  const nodeById = new Map<string, RailNode>();
  const pos = new Map<string, THREE.Vector3>();
  for (const n of rail.nodes) {
    nodeById.set(n.id, n);
    pos.set(n.id, new THREE.Vector3(n.position.x, n.position.y, n.position.z));
  }

  const edgeById = new Map<string, RailEdge>();
  const out = new Map<string, RailEdge[]>();
  const inn = new Map<string, RailEdge[]>();
  const len = new Map<string, number>();
  for (const e of rail.edges) {
    edgeById.set(e.id, e);
    push(out, e.from, e);
    push(inn, e.to, e);
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    len.set(e.id, a && b ? Math.max(EPS, a.distanceTo(b)) : EPS);
  }

  const start = rail.nodes.find((n) => n.kind === "start");
  const stations = rail.nodes.filter((n) => n.kind === "station");

  return {
    nodeById,
    pos,
    edgeById,
    out,
    inn,
    len,
    startId: start?.id ?? rail.nodes[0]?.id ?? "",
    stations,
  };
}

/** Lado lateral de `toId` respecto a `fromId`: <0 izquierda, 0 recto, >0 derecha. */
function laneDelta(g: NavGraph, fromId: string, toId: string): number {
  const a = g.nodeById.get(fromId);
  const b = g.nodeById.get(toId);
  if (!a || !b) return 0;
  return b.lane - a.lane;
}

/**
 * Elige la arista de continuación en un nodo según el rumbo del piloto.
 *   steer ≤ −0.33 → la más a la IZQUIERDA (menor Δcarril)
 *   steer ≥ +0.33 → la más a la DERECHA (mayor Δcarril)
 *   |steer| < 0.33 → la más RECTA (mínimo |Δcarril|, desempata por spine = misma vena)
 * `farId(e)` da el nodo hacia el que avanzaríamos por esa arista (to si vamos hacia
 * adelante, from si vamos hacia atrás), de modo que sirve en ambos sentidos.
 */
export function chooseEdge(
  g: NavGraph,
  nodeId: string,
  cands: RailEdge[],
  farId: (e: RailEdge) => string,
  steer: number
): RailEdge | null {
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];

  const scored = cands.map((e) => ({ e, d: laneDelta(g, nodeId, farId(e)) }));

  if (steer <= -0.33) return scored.reduce((m, s) => (s.d < m.d ? s : m)).e;
  if (steer >= 0.33) return scored.reduce((m, s) => (s.d > m.d ? s : m)).e;

  return scored.reduce((m, s) => {
    const a = Math.abs(s.d);
    const b = Math.abs(m.d);
    if (a < b) return s;
    if (a === b && s.e.kind === "spine" && m.e.kind !== "spine") return s;
    return m;
  }).e;
}

/** Estación más cercana a un punto (para ofrecer "Entrar"). */
export function nearestStation(
  g: NavGraph,
  p: THREE.Vector3
): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const s of g.stations) {
    const sp = g.pos.get(s.id);
    if (!sp) continue;
    const d = sp.distanceTo(p);
    if (!best || d < best.dist) best = { id: s.id, dist: d };
  }
  return best;
}
