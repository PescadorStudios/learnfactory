// ──────────────────────────────────────────────────
//  NIVELES DE ESCUCHA / RECORRIDO (gamificación global)
//  Dos progresiones acumulativas por usuario:
//  - Podcast: tiempo total escuchado (segundos).
//  - Túnel:   lecciones/estaciones completadas (conteo).
//  El valor crudo vive en profiles (podcast_seconds / tunnel_lessons); el nivel
//  se DERIVA aquí (no se guarda). Helpers puros: se usan igual en server y UI.
// ──────────────────────────────────────────────────

export interface LevelDef {
  level: number;
  name: string;
  /** Valor mínimo (segundos para podcast, lecciones para túnel) para alcanzarlo. */
  min: number;
  /** Tier visual reutilizado del sistema de reputación. */
  tier: "zinc" | "bronze" | "silver" | "gold" | "legend";
}

/** Tiempo escuchado en Podcast → nivel. Umbrales en SEGUNDOS. */
export const PODCAST_LEVELS: LevelDef[] = [
  { level: 1, name: "Oyente", tier: "zinc", min: 0 },
  { level: 2, name: "Curioso", tier: "zinc", min: 15 * 60 }, // 15 min
  { level: 3, name: "Aficionado", tier: "bronze", min: 60 * 60 }, // 1 h
  { level: 4, name: "Maratonista", tier: "silver", min: 3 * 3600 }, // 3 h
  { level: 5, name: "Erudito de audio", tier: "gold", min: 8 * 3600 }, // 8 h
  { level: 6, name: "Voz interior", tier: "legend", min: 20 * 3600 }, // 20 h
];

/** Lecciones recorridas en el Túnel → nivel. Umbrales en CONTEO. */
export const TUNNEL_LEVELS: LevelDef[] = [
  { level: 1, name: "Viajero", tier: "zinc", min: 0 },
  { level: 2, name: "Explorador", tier: "zinc", min: 5 },
  { level: 3, name: "Navegante", tier: "bronze", min: 15 },
  { level: 4, name: "Cartógrafo", tier: "silver", min: 40 },
  { level: 5, name: "Piloto neuronal", tier: "gold", min: 100 },
  { level: 6, name: "Leyenda del túnel", tier: "legend", min: 250 },
];

/** Tiempo visto en Modo Scroll → nivel. Umbrales en SEGUNDOS. */
export const SCROLL_LEVELS: LevelDef[] = [
  { level: 1, name: "Espectador", tier: "zinc", min: 0 },
  { level: 2, name: "Scroller", tier: "zinc", min: 10 * 60 }, // 10 min
  { level: 3, name: "Enganchado", tier: "bronze", min: 45 * 60 }, // 45 min
  { level: 4, name: "Devorador", tier: "silver", min: 2 * 3600 }, // 2 h
  { level: 5, name: "Maratón de cortos", tier: "gold", min: 6 * 3600 }, // 6 h
  { level: 6, name: "Mente infinita", tier: "legend", min: 15 * 3600 }, // 15 h
];

export interface LevelProgress {
  current: LevelDef;
  /** Siguiente nivel, o null si ya es el máximo. */
  next: LevelDef | null;
  /** Progreso 0-100 desde el inicio del nivel actual hacia el siguiente. */
  progressPct: number;
}

/** Nivel actual + progreso hacia el siguiente para un valor crudo y una tabla. */
export function levelFor(value: number, levels: LevelDef[]): LevelProgress {
  let current = levels[0];
  for (const l of levels) {
    if (value >= l.min) current = l;
  }
  const next = levels.find((l) => l.level === current.level + 1) ?? null;
  if (!next) return { current, next: null, progressPct: 100 };
  const span = Math.max(1, next.min - current.min);
  const progressPct = Math.round(Math.min(1, Math.max(0, (value - current.min) / span)) * 100);
  return { current, next, progressPct };
}

/** "12h 30m" / "45m" / "30s" — etiqueta compacta de tiempo escuchado. */
export function formatListened(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
