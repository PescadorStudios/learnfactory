// ============================================================================
// ENSAMBLAJE DEL RIEL EN RUNTIME — Capa 0.
// ----------------------------------------------------------------------------
// Cuando el usuario confirma su selección de lecciones:
//   1. Una VENA (branch) por lección, encadenando sus pods como estaciones.
//   2. START → primera estación de cada vena (fork inicial: "elige tu tema").
//   3. Donde se cruzan dos venas, un FORK: swipe izq/der para cambiar de tema
//      (la vena no elegida brilla y se aleja → FOMO, eso lo hace la Capa 1).
//   4. El grafo resultante { nodes, edges, forks, branches } ES la Capa 0.
//
// El motor NUNCA referencia un nicho por nombre: todo sale de los datos.
// ============================================================================

import type { Lesson } from "../types/contract";
import type {
  ForkDirection,
  Rail,
  RailBranch,
  RailEdge,
  RailFork,
  RailForkOption,
  RailNode,
} from "../types/rail";
import { colorForNiche } from "../theme";

const LANE_GAP = 6; // separación lateral entre venas (unidades de mundo)
const LAYER_GAP = 10; // separación en profundidad entre estaciones
const CROSS_EVERY = 2; // cada cuántas capas las venas se cruzan (bifurcaciones)

const START_ID = "start";
const END_ID = "end";

export function assembleRail(lessons: Lesson[]): Rail {
  const nodes: RailNode[] = [];
  const edges: RailEdge[] = [];
  const branches: RailBranch[] = [];

  const laneCount = lessons.length;
  const laneCenter = (laneCount - 1) / 2;
  const laneX = (lane: number) => (lane - laneCenter) * LANE_GAP;

  // --- START: entrada única, centrada, una capa antes del comienzo. ---
  nodes.push({
    id: START_ID,
    kind: "start",
    branchId: null,
    lane: laneCenter,
    layer: -1,
    position: { x: 0, y: 0, z: -LAYER_GAP },
  });

  // --- 1. Una vena por lección; sus pods encadenados como estaciones. ---
  let maxLayer = 0;
  lessons.forEach((lesson, lane) => {
    const color = colorForNiche(lesson.niche);
    const nodeIds: string[] = [];
    lesson.pods.forEach((pod, layer) => {
      const id = `${lesson.id}__${pod.id}`;
      nodeIds.push(id);
      nodes.push({
        id,
        kind: "station",
        branchId: lesson.id,
        lane,
        layer,
        position: { x: laneX(lane), y: 0, z: layer * LAYER_GAP },
        pod,
        lessonId: lesson.id,
        niche: lesson.niche,
        title: pod.title,
      });
      if (layer > maxLayer) maxLayer = layer;
    });
    branches.push({
      id: lesson.id,
      lessonId: lesson.id,
      title: lesson.title,
      niche: lesson.niche,
      lane,
      color,
      nodeIds,
    });
  });

  // --- END: salida única, centrada, una capa después del final. ---
  nodes.push({
    id: END_ID,
    kind: "end",
    branchId: null,
    lane: laneCenter,
    layer: maxLayer + 1,
    position: { x: 0, y: 0, z: (maxLayer + 1) * LAYER_GAP },
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeAtLayer = (b: RailBranch, layer: number): RailNode | undefined => {
    const id = b.nodeIds[layer];
    return id ? nodeById.get(id) : undefined;
  };

  const addEdge = (
    from: string,
    to: string,
    branchId: string | null,
    kind: RailEdge["kind"]
  ) => edges.push({ id: `${from}->${to}`, from, to, branchId, kind });

  // --- 2. START → primera estación de cada vena (fork inicial). ---
  for (const b of branches) {
    const first = b.nodeIds[0];
    if (first) addEdge(START_ID, first, null, "cross");
  }

  // --- Columna (spine): cada estación → la siguiente de su vena. ---
  for (const b of branches) {
    for (let i = 0; i < b.nodeIds.length - 1; i++) {
      addEdge(b.nodeIds[i], b.nodeIds[i + 1], b.id, "spine");
    }
  }

  // --- 3. Cruces entre venas adyacentes cada CROSS_EVERY capas. ---
  // Desde la estación (lane, layer) se puede saltar a (lane±1, layer+1).
  for (let layer = 0; layer < maxLayer; layer++) {
    if ((layer + 1) % CROSS_EVERY !== 0) continue;
    for (let lane = 0; lane < branches.length; lane++) {
      const from = nodeAtLayer(branches[lane], layer);
      if (!from) continue;
      for (const adj of [lane - 1, lane + 1]) {
        if (adj < 0 || adj >= branches.length) continue;
        const to = nodeAtLayer(branches[adj], layer + 1);
        if (!to) continue;
        addEdge(from.id, to.id, branches[adj].id, "cross");
      }
    }
  }

  // --- Última estación de cada vena → END. ---
  for (const b of branches) {
    const last = b.nodeIds[b.nodeIds.length - 1];
    if (last) addEdge(last, END_ID, null, "spine");
  }

  // --- 4. Forks = nodos con más de una arista saliente. ---
  const outByNode = new Map<string, RailEdge[]>();
  for (const e of edges) {
    const arr = outByNode.get(e.from) ?? [];
    arr.push(e);
    outByNode.set(e.from, arr);
  }

  const forks: RailFork[] = [];
  for (const [nodeId, outs] of outByNode) {
    if (outs.length < 2) continue;
    const src = nodeById.get(nodeId);
    if (!src) continue;
    const options: RailForkOption[] = outs
      .map((e) => {
        const target = nodeById.get(e.to);
        const lane = target?.lane ?? src.lane;
        return {
          edgeId: e.id,
          toNodeId: e.to,
          branchId: target?.branchId ?? null,
          niche: target?.niche ?? null,
          title: target?.title ?? (target?.kind === "end" ? "Salida" : "—"),
          lane,
        };
      })
      .sort((a, b) => a.lane - b.lane)
      .map(
        (o): RailForkOption => ({
          edgeId: o.edgeId,
          toNodeId: o.toNodeId,
          branchId: o.branchId,
          niche: o.niche,
          title: o.title,
          direction: directionOf(o.lane, src.lane),
        })
      );
    forks.push({ id: `fork__${nodeId}`, atNodeId: nodeId, options });
  }

  const niches = Array.from(new Set(lessons.map((l) => l.niche)));

  return {
    nodes,
    edges,
    forks,
    branches,
    meta: {
      stationCount: nodes.filter((n) => n.kind === "station").length,
      forkCount: forks.length,
      branchCount: branches.length,
      niches,
      depth: maxLayer + 1,
    },
  };
}

function directionOf(targetLane: number, srcLane: number): ForkDirection {
  if (targetLane < srcLane) return "left";
  if (targetLane > srcLane) return "right";
  return "straight";
}
