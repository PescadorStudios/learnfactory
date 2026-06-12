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

// ── Sistema de verificación de atención (3 mecánicas rotativas) ──

export type AttentionMode = "spy" | "subtitles" | "copilot";

/** Mecánica 1 — Misión de Espía: misiones reveladas antes del audio, respondidas al final. */
export interface SpyMission {
  /** Instrucción mostrada ANTES del audio: qué detectar mientras escucha. */
  instruccion: string;
  /** Pregunta directa al terminar el audio. */
  pregunta: string;
  options: string[]; // 3 opciones
  correctIndex: number;
}
export interface SpyData {
  mode: "spy";
  misiones: SpyMission[]; // 2-3
}

/** Mecánica 2 — Subtítulos Trampa: 12 subtítulos alterados que contradicen el audio. */
export interface SubtitleCue {
  atSeconds: number;
  endSeconds: number;
  /** Texto mostrado en pantalla (en las trampas, contradice lo narrado). */
  texto: string;
  /** true en los subtítulos trampa. */
  alterado: boolean;
  /** Lo que realmente dice el audio (para el feedback de resultados). */
  original?: string;
}
export interface SubtitlesData {
  mode: "subtitles";
  cues: SubtitleCue[];
  /** Número de trampas (12). */
  trampas: number;
}

/** Mecánica 3 — Co-Piloto Narrativo: el narrador duda y el oyente decide en 5 s. */
export interface CopilotCheckpoint {
  /** Momento del audio en que se pausa (fin de la pregunta narrada). */
  atSeconds: number;
  options: string[]; // exactamente 2, sin contexto suficiente por sí solas
  correctIndex: number;
  /** Corrección breve del narrador si el oyente falla o no responde. */
  correccion: string;
}
export interface CopilotData {
  mode: "copilot";
  checkpoints: CopilotCheckpoint[]; // 6
}

export type AttentionData = SpyData | SubtitlesData | CopilotData;

export interface MicroLessonData {
  attention: AttentionData | null; // null = sin audio o lección antigua
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
  visibility: RouteVisibility;
  coverUrl: string | null;
  description: string | null;
  category: RouteCategory;
}

// ── Social / biblioteca pública ──

export type RouteVisibility = "public" | "private";
export type Plan = "free" | "premium";

/** Categorías fijas de rutas. Las rutas existentes caen en "otros". */
export const ROUTE_CATEGORIES = [
  { id: "negocios", label: "Negocios y finanzas" },
  { id: "marketing", label: "Marketing" },
  { id: "ia", label: "Inteligencia Artificial" },
  { id: "contenido", label: "Creación de Contenido" },
  { id: "salud", label: "Salud y Nutrición" },
  { id: "teologia", label: "Teología" },
  { id: "historia", label: "Historia y Filosofía" },
  { id: "arte", label: "Arte y Creatividad" },
  { id: "otros", label: "Otros" },
] as const;

export type RouteCategory = (typeof ROUTE_CATEGORIES)[number]["id"];

export function categoryLabel(id: string): string {
  return ROUTE_CATEGORIES.find(c => c.id === id)?.label ?? "Otros";
}

export interface PlanState {
  plan: Plan;
  routeQuota: number;
  routesUsed: number;
  premiumSince: string | null;
  /** Creación de rutas en lote: el admin la activa manualmente por usuario. */
  batchEnabled: boolean;
}

/** Tarjeta de ruta para la biblioteca estilo Netflix. */
export interface RouteCard {
  id: string;
  topic: string;
  description: string | null;
  coverUrl: string | null;
  visibility: RouteVisibility;
  category: RouteCategory;
  ratingAvg: number | null;
  ratingCount: number;
  studentCount: number;
  favoriteCount: number;
  creator: { username: string | null; displayName: string | null; avatarUrl: string | null; graduates: number };
}

export interface LibrarySection {
  key: string;
  title: string;
  routes: RouteCard[];
}

export interface FeaturedCreator {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  routeCount: number;
  studentTotal: number;
  graduates: number;
}

export interface ProfileStats {
  routeCount: number;
  studentTotal: number;
  ratingAvg: number | null;
  followers: number;
  following: number;
  // Reputación de dos vías
  /** Rutas que este usuario completó (≥80% de lecciones aprobadas). */
  routesCompleted: number;
  /** Media global de la mejor estrella por nodo (calidad como explorador). */
  avgStars: number;
  /** Estudiantes distintos graduados (≥80%) en sus rutas (vía creador). */
  graduates: number;
}

export interface PublicProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  plan: Plan;
  isOwner: boolean;
  isFollowing: boolean;
  /** false = el dueño ocultó su perfil: terceros ven solo la vista mínima. */
  profilePublic: boolean;
  stats: ProfileStats;
  routes: RouteCard[];
}

/** Estudiante de una ruta (lista de la ficha). */
export interface RouteStudent {
  /** null si el perfil es privado y el viewer no es el dueño de la ruta. */
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** true → mostrar como "Explorador anónimo" sin link. */
  anonymous: boolean;
  /** % de la ruta completado (0-100). */
  completionPct: number;
  /** Media de estrellas del estudiante EN ESTA ruta. */
  avgStars: number | null;
  /** Reputación de explorador (para el badge). */
  routesCompleted: number;
  explorerAvgStars: number;
}

/** Ficha (landing) de una ruta antes de estudiarla. */
export interface RouteLanding {
  id: string;
  topic: string;
  description: string | null;
  coverUrl: string | null;
  visibility: RouteVisibility;
  category: RouteCategory;
  coverPrompt: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  studentCount: number;
  favoriteCount: number;
  completionAvg: number | null;
  totalNodes: number;
  creator: { id: string; username: string | null; displayName: string | null; avatarUrl: string | null; graduates: number };
  myRating: number | null;
  isFavorite: boolean;
  isOwner: boolean;
  myCompletedNodes: number;
}

export interface NodeState {
  status: LessonGenStatus;
  error: string | null;
  bestStars: number | null;
  attemptCount: number;
  mastery: number | null;
  reviewDue: boolean;
  /** true si lleva demasiado tiempo en "generating" (proceso huérfano): se puede reintentar. */
  stale: boolean;
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
  visibility: RouteVisibility;
  coverUrl: string | null;
  description: string | null;
  isOwner: boolean;
  /** Rango de explorador del usuario (1-5), para celebrar rank-ups en el árbol. */
  explorerRank: number;
  /** % de ESTA ruta completado por el usuario (0-100). */
  myCompletionPct: number;
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
  attention: AttentionData | null; // juego de atención del audio
  audioUrl: string | null;
  audioDurationSeconds: number | null;
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
  /** Si este intento hizo subir el rango de explorador, el nuevo nivel (2-5). */
  explorerRankUp?: number;
}
