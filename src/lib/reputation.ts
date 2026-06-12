// ──────────────────────────────────────────────────
//  SISTEMA DE REPUTACIÓN DE DOS VÍAS
//  Cada perfil es a la vez EXPLORADOR (estudia rutas) y CREADOR (publica
//  rutas). 5 rangos por vía, con requisitos acumulativos:
//  - Explorador: rutas completadas (≥80% de lecciones aprobadas) + calidad
//    (media global de estrellas).
//  - Creador: graduados (estudiantes distintos que terminaron ≥80% de
//    alguna de sus rutas). Meta final: 1.000 graduados.
//  Helpers puros: se usan igual en server actions y en la UI.
// ──────────────────────────────────────────────────

/** Umbral de "ruta completada / estudiante graduado": 80% de las lecciones. */
export const GRADUATE_THRESHOLD = 0.8;

export interface RankDef {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  /** Tier visual: zinc | bronze | silver | gold | legend */
  tier: "zinc" | "bronze" | "silver" | "gold" | "legend";
}

export const EXPLORER_RANKS: (RankDef & { minRoutes: number; minStars: number })[] = [
  { level: 1, name: "Curioso", tier: "zinc", minRoutes: 0, minStars: 0 },
  { level: 2, name: "Aprendiz", tier: "bronze", minRoutes: 1, minStars: 0 },
  { level: 3, name: "Erudito", tier: "silver", minRoutes: 3, minStars: 3.5 },
  { level: 4, name: "Sabio", tier: "gold", minRoutes: 8, minStars: 4.0 },
  { level: 5, name: "Gran Sabio", tier: "legend", minRoutes: 20, minStars: 4.5 },
];

export const CREATOR_RANKS: (RankDef & { minGraduates: number })[] = [
  { level: 1, name: "Chispa", tier: "zinc", minGraduates: 0 },
  { level: 2, name: "Artesano", tier: "bronze", minGraduates: 5 },
  { level: 3, name: "Mentor", tier: "silver", minGraduates: 50 },
  { level: 4, name: "Arquitecto", tier: "gold", minGraduates: 250 },
  { level: 5, name: "Leyenda", tier: "legend", minGraduates: 1000 },
];

/** Rango de explorador según rutas completadas y media global de estrellas. */
export function explorerRank(routesCompleted: number, avgStars: number): RankDef {
  let current: RankDef = EXPLORER_RANKS[0];
  for (const r of EXPLORER_RANKS) {
    if (routesCompleted >= r.minRoutes && avgStars >= r.minStars) current = r;
  }
  return current;
}

/** Rango de creador según graduados acumulados. */
export function creatorRank(graduates: number): RankDef {
  let current: RankDef = CREATOR_RANKS[0];
  for (const r of CREATOR_RANKS) {
    if (graduates >= r.minGraduates) current = r;
  }
  return current;
}

export interface RankProgress {
  rank: RankDef;
  /** Siguiente rango, o null si ya es el máximo. */
  next: RankDef | null;
  /** Progreso 0-100 hacia el siguiente rango. */
  pct: number;
  /** Texto concreto de lo que falta ("2 rutas más y +0.3★"). */
  missingLabel: string | null;
}

export function explorerProgress(routesCompleted: number, avgStars: number): RankProgress {
  const rank = explorerRank(routesCompleted, avgStars);
  const next = EXPLORER_RANKS.find(r => r.level === rank.level + 1) ?? null;
  if (!next) return { rank, next: null, pct: 100, missingLabel: null };

  const nextDef = next as (typeof EXPLORER_RANKS)[number];
  const routesPct = Math.min(1, routesCompleted / Math.max(1, nextDef.minRoutes));
  const starsPct = nextDef.minStars > 0 ? Math.min(1, avgStars / nextDef.minStars) : 1;
  const pct = Math.round(Math.min(routesPct, starsPct) * 100);

  const missing: string[] = [];
  const routesLeft = nextDef.minRoutes - routesCompleted;
  if (routesLeft > 0) missing.push(`${routesLeft} ${routesLeft === 1 ? "ruta más" : "rutas más"}`);
  if (avgStars < nextDef.minStars) {
    missing.push(`media de ${nextDef.minStars.toFixed(1)}★ (vas en ${avgStars.toFixed(1)}★)`);
  }
  return { rank, next, pct, missingLabel: missing.length ? missing.join(" y ") : null };
}

export function creatorProgress(graduates: number): RankProgress {
  const rank = creatorRank(graduates);
  const next = CREATOR_RANKS.find(r => r.level === rank.level + 1) ?? null;
  if (!next) return { rank, next: null, pct: 100, missingLabel: null };

  const nextDef = next as (typeof CREATOR_RANKS)[number];
  const prevMin = (CREATOR_RANKS.find(r => r.level === rank.level) as (typeof CREATOR_RANKS)[number]).minGraduates;
  const span = Math.max(1, nextDef.minGraduates - prevMin);
  const pct = Math.round(Math.min(1, (graduates - prevMin) / span) * 100);
  const left = nextDef.minGraduates - graduates;
  return {
    rank,
    next,
    pct,
    missingLabel: left > 0 ? `${left} ${left === 1 ? "graduado más" : "graduados más"}` : null,
  };
}
