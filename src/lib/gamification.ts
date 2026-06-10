// ──────────────────────────────────────────────────
//  Gamificación: valores de XP y cálculo de estrellas (0-5).
//  La persistencia vive en Supabase (attempts / concept_mastery).
// ──────────────────────────────────────────────────

export const XP = {
  lessonComplete: 50,
  quizCorrectFirstTry: 10,
  perSocraticPoint: 8, // puntuación 0-5 → 0-40 XP
  debateBase: 80,
  bossPass: 200,
  audioFocusPass: 15,
};

/** Redondea a medias estrellas dentro de [0, 5] */
function toHalfStars(pct: number): number {
  return Math.max(0, Math.min(5, Math.round(pct * 10) / 2));
}

/** Lección theory/practice: atención 30% + socráticas 50% + quiz 20% */
export function starsForMicroLesson(d: {
  attentionCorrect: number;
  attentionTotal: number;
  socraticScores: number[]; // 0-5 c/u
  quizCorrect: boolean;
}): number {
  const att = d.attentionTotal > 0 ? d.attentionCorrect / d.attentionTotal : 1;
  const soc = d.socraticScores.length
    ? d.socraticScores.reduce((a, b) => a + b, 0) / d.socraticScores.length / 5
    : 0;
  const pct = att * 0.3 + soc * 0.5 + (d.quizCorrect ? 0.2 : 0);
  return toHalfStars(pct);
}

export function starsForQuiz(correct: number, total: number): number {
  return toHalfStars(total > 0 ? correct / total : 0);
}

export function starsForBoss(points: number, total: number): number {
  return toHalfStars(total > 0 ? points / total : 0);
}
