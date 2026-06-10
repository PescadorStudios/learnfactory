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

// ── Intro de audio con juego de atención ──

export interface AttentionQuestion {
  atSeconds: number; // momento del audio en que aparece
  question: string;
  options: string[]; // exactamente 2
  correctIndex: number;
}

export interface AudioIntroData {
  durationSeconds: number;
  questions: AttentionQuestion[];
}

export interface MicroLessonData {
  audioIntro: AudioIntroData | null; // null = sin audio (TTS falló o sin API key)
  steps: LessonStep[];
}

/** Respuesta completa de la action (el base64 NO se guarda en localStorage) */
export interface MicroLessonResponse {
  lesson: MicroLessonData;
  audioWavBase64: string | null;
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

// ── Rutas y lecciones persistidas (Supabase) ──

export type LessonGenStatus = "pending" | "generating" | "ready" | "error";

export interface RouteSummary {
  id: string;
  topic: string;
  status: string; // generating | ready | error
  createdAt: string;
  totalNodes: number;
  readyNodes: number;
  completedNodes: number;
  avgStars: number | null;
}

export interface NodeState {
  status: LessonGenStatus;
  error: string | null;
  bestStars: number | null;
  attemptCount: number;
  mastery: number | null;
  reviewDue: boolean;
}

export interface RouteDetail {
  id: string;
  topic: string;
  status: string;
  sintesis: Sintesis;
  tree: Tree;
  nodes: Record<string, NodeState>;
  xpTotal: number;
  streakDays: number;
}

export interface LessonData {
  nodeId: string;
  nodeType: NodeType;
  title: string;
  conceptIds: string[];
  status: LessonGenStatus;
  error: string | null;
  steps: LessonStep[] | null; // theory / practice
  quiz: QuizNodeData | null; // nodos quiz
  boss: BossExamData | null; // nodos boss
  audioIntro: AudioIntroData | null;
  audioUrl: string | null;
  topic: string;
  sintesis: Sintesis; // para debate y evaluaciones
}

// ── Intentos y puntuación ──

export interface AttemptDetail {
  attention?: { correct: number; total: number };
  socratic?: number[]; // puntuaciones 0-5
  quizCorrect?: number;
  quizTotal?: number;
  bossPoints?: number;
  bossTotal?: number;
}

/** Resultado que cada experiencia de nodo entrega a onComplete */
export interface AttemptInput {
  stars: number; // 0-5 (medias permitidas)
  passed: boolean;
  xp: number;
  detail: AttemptDetail;
  masteryUpdates: Array<{ conceptId: string; delta: number }>;
}

export interface SaveAttemptResult {
  ok: boolean;
  xpGained: number;
  newBest: boolean;
  bestStars: number;
}
