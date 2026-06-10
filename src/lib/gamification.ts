// ──────────────────────────────────────────────────
//  Gamificación de LearnFactory (persistencia en localStorage)
// ──────────────────────────────────────────────────

import type {
  XpState,
  StreakState,
  MasteryState,
  ProgressEntry,
  Tree,
  NodeResult,
} from "./types";

export const XP = {
  lessonComplete: 50,
  quizCorrectFirstTry: 10,
  perSocraticPoint: 10, // puntuación 0-3 → 0-30 XP
  debateBase: 80,
  bossPass: 200,
  reviewSession: 40,
  dailyStreakBonus: 20,
  predictCorrect: 5,
};

export const REVIEW_AFTER_DAYS = 4;
export const REVIEW_MASTERY_THRESHOLD = 80;

// ── Helpers de lectura/escritura ──

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ── XP ──

export function getXp(topic: string): XpState {
  return readJson<XpState>(`learnfactory_xp_${topic}`, { total: 0, ledger: [] });
}

export function addXp(topic: string, nodeId: string, events: Array<{ action: string; xp: number }>): number {
  const state = getXp(topic);
  const ts = new Date().toISOString();
  let gained = 0;
  for (const ev of events) {
    if (ev.xp <= 0) continue;
    state.ledger.push({ ts, nodeId, action: ev.action, xp: ev.xp });
    state.total += ev.xp;
    gained += ev.xp;
  }
  writeJson(`learnfactory_xp_${topic}`, state);
  return gained;
}

// ── Racha diaria ──

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getStreak(): StreakState {
  return readJson<StreakState>("learnfactory_streak", { lastActiveDate: "", current: 0, best: 0 });
}

/** Registra actividad hoy. Devuelve la racha actualizada y si toca bonus de día nuevo. */
export function touchStreak(): { streak: StreakState; bonusAwarded: boolean } {
  const streak = getStreak();
  const today = todayStr();
  if (streak.lastActiveDate === today) {
    return { streak, bonusAwarded: false };
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  streak.current = streak.lastActiveDate === yesterday ? streak.current + 1 : 1;
  streak.best = Math.max(streak.best, streak.current);
  streak.lastActiveDate = today;
  writeJson("learnfactory_streak", streak);
  return { streak, bonusAwarded: true };
}

// ── Maestría por concepto ──

export function getMastery(topic: string): MasteryState {
  return readJson<MasteryState>(`learnfactory_mastery_${topic}`, {});
}

export function applyMasteryUpdates(topic: string, updates: Array<{ conceptId: string; delta: number }>) {
  if (updates.length === 0) return;
  const mastery = getMastery(topic);
  const ts = new Date().toISOString();
  for (const u of updates) {
    if (!u.conceptId) continue;
    const entry = mastery[u.conceptId] || { score: 0, lastReviewed: ts, attempts: 0 };
    entry.score = Math.max(0, Math.min(100, entry.score + u.delta));
    entry.lastReviewed = ts;
    entry.attempts += 1;
    mastery[u.conceptId] = entry;
  }
  writeJson(`learnfactory_mastery_${topic}`, mastery);
}

/** Maestría media (0-100) de un conjunto de conceptos; null si no hay datos */
export function averageMastery(mastery: MasteryState, conceptIds: string[] = []): number | null {
  const scores = conceptIds.map(id => mastery[id]?.score).filter((s): s is number => typeof s === "number");
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ── Progreso (con migración desde el formato viejo de strings) ──

export function getProgress(topic: string): ProgressEntry[] {
  const raw = readJson<Array<string | ProgressEntry>>(`learnfactory_progress_${topic}`, []);
  return raw.map(item =>
    typeof item === "string" ? { id: item, completedAt: new Date().toISOString() } : item
  );
}

export function markCompleted(topic: string, nodeId: string) {
  const progress = getProgress(topic);
  if (!progress.some(p => p.id === nodeId)) {
    progress.push({ id: nodeId, completedAt: new Date().toISOString() });
  }
  writeJson(`learnfactory_progress_${topic}`, progress);
}

// ── Cierre centralizado de un nodo ──

/**
 * Aplica el resultado de una experiencia de nodo: XP (+ bonus de racha),
 * maestría y progreso. Devuelve el XP total ganado (para el toast).
 */
export function completeNode(topic: string, nodeId: string, result: NodeResult): number {
  const events = [...result.xpEvents];

  const { bonusAwarded } = touchStreak();
  if (bonusAwarded) {
    events.push({ action: "racha_diaria", xp: XP.dailyStreakBonus });
  }

  applyMasteryUpdates(topic, result.masteryUpdates);

  // El boss solo completa el nodo si se aprueba; los repasos no re-completan nada
  if (result.passed !== false && !result.isReview) {
    markCompleted(topic, nodeId);
  }

  return addXp(topic, nodeId, events);
}

// ── Conceptos ya estudiados ──

/** Conceptos cubiertos por nodos ya completados (para recaps y preguntas de repaso) */
export function getStudiedConceptIds(topic: string, excludeFocal: string[] = []): string[] {
  if (typeof window === "undefined") return [];
  try {
    const tree: Tree | null = JSON.parse(localStorage.getItem(`learnfactory_tree_${topic}`) || "null");
    if (!tree?.levels) return [];
    const completedIds = getProgress(topic).map(p => p.id);
    const ids = new Set<string>();
    for (const level of tree.levels) {
      for (const node of level.nodes) {
        if (completedIds.includes(node.id)) {
          for (const cid of node.conceptIds || []) ids.add(cid);
        }
      }
    }
    for (const f of excludeFocal) ids.delete(f);
    return [...ids];
  } catch {
    return [];
  }
}

// ── Repaso espaciado ligero ──

/** IDs de nodos completados que están "pendientes de repaso" */
export function getReviewDueNodes(tree: Tree, progress: ProgressEntry[], mastery: MasteryState): string[] {
  const due: string[] = [];
  const now = Date.now();
  const threshold = REVIEW_AFTER_DAYS * 86400000;

  for (const level of tree.levels) {
    for (const node of level.nodes) {
      const entry = progress.find(p => p.id === node.id);
      if (!entry) continue;

      const conceptIds = node.conceptIds || [];
      const avg = averageMastery(mastery, conceptIds);
      if (avg !== null && avg >= REVIEW_MASTERY_THRESHOLD) continue;

      // Última vez que se tocó: lo más reciente entre completado y repasos de sus conceptos
      let lastTouched = new Date(entry.completedAt).getTime();
      for (const cid of conceptIds) {
        const m = mastery[cid];
        if (m?.lastReviewed) {
          lastTouched = Math.max(lastTouched, new Date(m.lastReviewed).getTime());
        }
      }

      if (now - lastTouched > threshold) {
        due.push(node.id);
      }
    }
  }
  return due;
}
