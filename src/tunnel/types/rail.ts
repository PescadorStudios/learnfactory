// ============================================================================
// EL RIEL — Capa 0. El viaje es un GRAFO en datos, ensamblado en runtime a
// partir de las lecciones que el usuario seleccionó (ver rail/assembleRail.ts).
// ----------------------------------------------------------------------------
// El viaje es CONFIGURACIÓN, no un asset. El render (Capa 1) y las estaciones
// (Capa 2) SOLO leen de aquí. Cambiar la selección reconstruye este grafo;
// nada del render se hardcodea.
// ============================================================================

import type { Niche, Pod } from "./contract";

export type RailNodeKind = "start" | "station" | "end";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Un nodo del riel. Solo las estaciones llevan `pod` (contenido). */
export interface RailNode {
  id: string;
  kind: RailNodeKind;
  branchId: string | null; // null en start / end
  lane: number; // carril lateral (a qué vena pertenece)
  layer: number; // profundidad sobre el riel (-1 = start)
  position: Vec3; // posición aproximada para la curva / visualización debug
  // Solo en estaciones (kind === "station"):
  pod?: Pod;
  lessonId?: string;
  niche?: Niche;
  title?: string;
}

/** Una arista del riel: tramo entre dos nodos. */
export interface RailEdge {
  id: string;
  from: string; // id de nodo origen
  to: string; // id de nodo destino
  branchId: string | null;
  kind: "spine" | "cross"; // spine = dentro de la vena; cross = salto entre venas
}

export type ForkDirection = "left" | "straight" | "right";

export interface RailForkOption {
  edgeId: string;
  toNodeId: string;
  branchId: string | null;
  niche: Niche | null;
  title: string;
  direction: ForkDirection; // mapeo para swipe izquierda / centro / derecha
}

/** Una bifurcación: nodo con más de una salida. El jugador elige (swipe). */
export interface RailFork {
  id: string;
  atNodeId: string;
  options: RailForkOption[]; // ordenadas izquierda → derecha
}

/** Una vena: la cadena de estaciones que aporta una lección. */
export interface RailBranch {
  id: string;
  lessonId: string;
  title: string;
  niche: Niche;
  lane: number;
  color: string; // color bioluminiscente asignado para la piel / debug
  nodeIds: string[]; // estaciones en orden
}

/** El grafo completo. Esto ES la Capa 0. */
export interface Rail {
  nodes: RailNode[];
  edges: RailEdge[];
  forks: RailFork[];
  branches: RailBranch[];
  meta: {
    stationCount: number;
    forkCount: number;
    branchCount: number;
    niches: Niche[];
    depth: number; // número de capas de profundidad
  };
}
