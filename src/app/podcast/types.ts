import type { PodcastLesson } from "@/app/routeActions";

/** Una pista en la cola del reproductor: la lección + el tema de su ruta. */
export interface PodcastTrack extends PodcastLesson {
  routeTopic: string;
}

/** ID estable de una lección dentro del catálogo (ruta + nodo). */
export function trackId(l: { routeId: string; nodeId: string }): string {
  return `${l.routeId}::${l.nodeId}`;
}
