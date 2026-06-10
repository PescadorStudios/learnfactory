// ──────────────────────────────────────────────────
//  Tipos compartidos de LearnFactory
// ──────────────────────────────────────────────────

// ── Síntesis Maestra (grounding) ──

export interface Concepto {
  id: string; // "c1", "c2"...
  nombre: string;
  definicion: string;
  citaTextual: string;
  relacion: string;
}

export interface Sintesis {
  tesisGlobal: string;
  conceptos: Concepto[];
  advertenciasDeContexto: string[];
}

// ── Árbol de conocimiento ──

export type NodeType = "theory" | "practice" | "debate" | "quiz" | "boss";
export type NodeStatus = "locked" | "unlocked" | "completed";

export interface TreeNode {
  id: string; // "1a", "2b"...
  title: string;
  status: NodeStatus;
  type: NodeType;
  conceptIds?: string[];
}

export interface TreeLevel {
  id: number;
  title: string;
  description: string;
  nodes: TreeNode[];
}

export interface Tree {
  topic: string;
  levels: TreeLevel[];
}

export interface StudyPack {
  sintesis: Sintesis;
  tree: Tree;
}

// ── Pasos de microlección ──

export interface ContentStep {
  type: "theory" | "analogy";
  title: string;
  content: string;
  cita?: string;
}

export interface OpenQuestionStep {
  type: "elaboration" | "debate";
  title: string;
  prompt: string;
  conceptContext?: string;
}

export interface QuizStep {
  type: "quiz";
  title: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explicacion?: string;
  conceptId?: string;
}

export type LessonStep = ContentStep | OpenQuestionStep | QuizStep;

// ── Briefing estilo "stories" (contexto previo a la lección) ──

export interface InfoBriefingCard {
  kind: "hook" | "recap" | "context";
  emoji: string;
  title: string;
  text: string;
}

export interface VocabBriefingCard {
  kind: "vocab";
  emoji: string;
  title: string;
  terms: Array<{ termino: string; definicion: string }>;
}

export interface PredictBriefingCard {
  kind: "predict";
  emoji: string;
  title: string;
  question: string;
  options: string[];
  correctIndex: number;
  reveal: string;
}

export type BriefingCard = InfoBriefingCard | VocabBriefingCard | PredictBriefingCard;

export interface MicroLessonData {
  briefing: BriefingCard[];
  steps: LessonStep[];
}

// ── Evaluación socrática ──

export interface SocraticEvaluation {
  puntuacion: number; // 0-3
  fortalezas: string[];
  mejoras: string[];
  ideaClave: string;
}

// ── Debate multi-turno ──

export interface DebateMessage {
  rol: "ia" | "estudiante";
  texto: string;
}

export interface DebateTurnResult {
  mensajeIA: string;
  esCierre: boolean;
  feedbackFinal?: SocraticEvaluation;
}

// ── Quiz acumulativo y Boss ──

export interface QuizQuestionData {
  question: string;
  options: string[];
  correctAnswer: number;
  explicacion: string;
  conceptId?: string;
}

export interface QuizNodeData {
  preguntas: QuizQuestionData[];
}

export interface BossExamData {
  preguntas: QuizQuestionData[];
  preguntaAbierta: {
    prompt: string;
    conceptContext: string;
  };
}

// ── Gamificación ──

export interface XpLedgerEntry {
  ts: string; // ISO
  nodeId: string;
  action: string;
  xp: number;
}

export interface XpState {
  total: number;
  ledger: XpLedgerEntry[];
}

export interface StreakState {
  lastActiveDate: string; // "YYYY-MM-DD"
  current: number;
  best: number;
}

export interface MasteryEntry {
  score: number; // 0-100
  lastReviewed: string; // ISO
  attempts: number;
}

export type MasteryState = Record<string, MasteryEntry>;

export interface ProgressEntry {
  id: string;
  completedAt: string; // ISO
}

/** Resultado que cada experiencia de nodo entrega a onComplete */
export interface NodeResult {
  xpEvents: Array<{ action: string; xp: number }>;
  masteryUpdates: Array<{ conceptId: string; delta: number }>;
  passed?: boolean; // solo boss: si no aprueba, el nodo no se completa
  isReview?: boolean;
}
