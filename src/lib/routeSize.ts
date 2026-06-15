// ============================================================================
// Tamaños de ruta: corta / mediana / completa.
// "Más larga" = más lecciones/nodos (escalamos la estructura del árbol, no la
// profundidad de cada lección). Cada tamaño consume créditos del balance del
// usuario (profiles.route_quota), y cada ruta guarda su costo en routes.credits.
// ============================================================================

export type RouteSize = "short" | "medium" | "full";

export const ROUTE_SIZES: RouteSize[] = ["short", "medium", "full"];

/** Créditos que consume cada tamaño contra el balance del usuario. */
export const ROUTE_SIZE_CREDITS: Record<RouteSize, number> = {
  short: 1,
  medium: 2,
  full: 3,
};

export interface RouteSizeSpec {
  size: RouteSize;
  label: string;
  /** Descripción corta para la tarjeta del selector. */
  blurb: string;
  conceptsMin: number;
  conceptsMax: number;
  levelsMin: number;
  levelsMax: number;
  /** Tope de caracteres de la síntesis maestra. */
  synthesisChars: number;
  /** maxOutputTokens del JSON del study pack (escala con el tamaño). */
  maxOutputTokens: number;
}

/** Targets de estructura del árbol por tamaño (mediana ≈ 2×, completa ≈ 3×). */
export const ROUTE_SIZE_SPEC: Record<RouteSize, RouteSizeSpec> = {
  short: {
    size: "short",
    label: "Corta",
    blurb: "Lo esencial del tema.",
    conceptsMin: 6,
    conceptsMax: 12,
    levelsMin: 3,
    levelsMax: 5,
    synthesisChars: 5000,
    maxOutputTokens: 8192,
  },
  medium: {
    size: "medium",
    label: "Mediana",
    blurb: "El doble de larga: más conceptos y lecciones.",
    conceptsMin: 12,
    conceptsMax: 22,
    levelsMin: 5,
    levelsMax: 7,
    synthesisChars: 10000,
    maxOutputTokens: 24000,
  },
  full: {
    size: "full",
    label: "Completa",
    blurb: "El triple de larga: cobertura exhaustiva del material.",
    conceptsMin: 18,
    conceptsMax: 32,
    levelsMin: 7,
    levelsMax: 9,
    synthesisChars: 15000,
    maxOutputTokens: 48000,
  },
};

export function creditsFor(size: RouteSize): number {
  return ROUTE_SIZE_CREDITS[size] ?? 1;
}

export function specFor(size: RouteSize): RouteSizeSpec {
  return ROUTE_SIZE_SPEC[size] ?? ROUTE_SIZE_SPEC.short;
}

/** Normaliza un valor arbitrario (DB / input) a un RouteSize válido. */
export function normalizeSize(value: unknown): RouteSize {
  return ROUTE_SIZES.includes(value as RouteSize) ? (value as RouteSize) : "short";
}
