// ============================================================================
// PATH ACTIVO — deriva del grafo (Capa 0) + las decisiones tomadas en los forks.
// ----------------------------------------------------------------------------
// El mundo 3D no recorre "el riel entero": recorre UN camino que el viajero va
// destrabando fork a fork. `resolvePath` camina desde START siguiendo la arista
// elegida en cada bifurcación; si llega a un fork sin decidir, se detiene ahí
// (ese nodo es el "horizonte de decisión" y la curva termina justo antes).
// Es puro y agnóstico: solo conoce nodos/aristas/forks, nunca el contenido.
// ============================================================================

import * as THREE from "three";
import type { Rail, RailEdge, RailFork, RailNode } from "../types/rail";

export interface ResolvedPath {
  /** Nodos desde START hasta el END o hasta el primer fork sin decidir. */
  nodes: RailNode[];
  /** Fork que espera decisión al final del path (o null si llegó al END). */
  pendingFork: RailFork | null;
  /** El path llega hasta el nodo END. */
  atEnd: boolean;
}

export function resolvePath(
  rail: Rail,
  choices: Record<string, string>
): ResolvedPath {
  const nodeById = new Map(rail.nodes.map((n) => [n.id, n]));
  const forkByNode = new Map(rail.forks.map((f) => [f.atNodeId, f]));
  const outByNode = new Map<string, RailEdge[]>();
  for (const e of rail.edges) {
    const list = outByNode.get(e.from);
    if (list) list.push(e);
    else outByNode.set(e.from, [e]);
  }

  const start = rail.nodes.find((n) => n.kind === "start");
  const nodes: RailNode[] = [];
  if (!start) return { nodes, pendingFork: null, atEnd: true };

  let current: RailNode | undefined = start;
  const guard = rail.nodes.length + 4; // anti-bucle por si el grafo viene mal
  let steps = 0;

  while (current && steps++ < guard) {
    nodes.push(current);
    if (current.kind === "end") return { nodes, pendingFork: null, atEnd: true };

    const outs = outByNode.get(current.id) ?? [];
    if (outs.length === 0) return { nodes, pendingFork: null, atEnd: true };

    const fork = forkByNode.get(current.id);
    let nextId: string;
    if (fork) {
      const chosen = choices[current.id];
      if (!chosen) return { nodes, pendingFork: fork, atEnd: false };
      nextId =
        fork.options.find((o) => o.edgeId === chosen)?.toNodeId ?? outs[0].to;
    } else {
      nextId = outs[0].to;
    }
    current = nodeById.get(nextId);
  }

  return { nodes, pendingFork: null, atEnd: true };
}

/** Curva suave que la cámara recorre. Necesita ≥2 puntos. */
export function buildCurve(nodes: RailNode[]): THREE.CatmullRomCurve3 | null {
  if (nodes.length < 2) return null;
  const pts = nodes.map(
    (n) => new THREE.Vector3(n.position.x, n.position.y, n.position.z)
  );
  // 'centripetal' evita cúspides/overshoot cuando una vena cambia de carril.
  return new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
}
