// Estado de runtime compartido entre el rig de cámara (escribe) y el resto del
// mundo (lee), por fuera de React para no re-renderizar 60 veces por segundo.
export interface TunnelRuntime {
  /** Velocidad de avance suavizada (unidades/seg). */
  speed: number;
  /** Parámetro normalizado 0-1 a lo largo de la curva activa. */
  u: number;
  /** Distancia recorrida en unidades de mundo. */
  distance: number;
}
