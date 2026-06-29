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
  /** Aviso legible si las fuentes se recortaron por exceder el presupuesto. */
  sourceNotice?: string;
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

// ── Modo Scroll (feed vertical estilo reels) ──
// El "corto" de una lección NO es un MP4: es un timeline declarativo que el
// Director (Gemini) produce UNA vez offline y el reproductor vertical renderiza
// EN VIVO sincronizado al audio TTS existente. Doble codificación (Paivio): cada
// cue codifica visualmente el MISMO significado que narra el audio.

/** Estado global de los videos del Modo Scroll de una ruta (routes.videos_estado). */
export type VideosEstado = "sin_videos" | "generando" | "listo" | "error";

/**
 * Vocabulario VISUAL CERRADO. El Director SOLO puede elegir de esta lista; nunca
 * inventa un componente. Cada entrada existe como componente React (render en
 * vivo) con la misma firma de props que produce el Director.
 */
export const COMPONENTES_SCROLL = [
  "TermCallout",  // un término/definición destacado
  "BuildList",    // lista que se construye ítem a ítem
  "VersusSplit",  // comparación a dos columnas (A vs B)
  "Timeline",     // secuencia temporal / hitos
  "NodeGraph",    // jerarquía o grafo de relaciones
  "Counter",      // una cantidad que cuenta hasta un valor
  "StepFlow",     // proceso de pasos secuenciales
  "QuoteBeat",    // cita textual destacada
  "KeyImage",     // imagen/idea ancla con rótulo
  "ProgressBar",  // avance/proporción
] as const;

export type ComponenteScroll = (typeof COMPONENTES_SCROLL)[number];

/** Una aparición visual del corto, anclada a tiempos del audio (ms). */
export interface TimelineCue {
  start_ms: number;
  end_ms: number;
  componente: ComponenteScroll;
  /** Solo los datos que ese componente necesita (textos, ítems, valores). */
  props: Record<string, unknown>;
}

/** Contrato de salida del Director — el "corto" declarativo de una lección. */
export interface LessonTimeline {
  leccion_id: string;
  ruta_id: string;
  duracion_ms: number;
  aspect: "9:16";
  audio_url: string;
  cues: TimelineCue[];
  /** Motor que produjo el timeline (diagnóstico de sincronía). */
  motor?: "multimodal" | "texto";
}

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

// ── Tutor/Agente por ruta (chat con memoria, dudas globales de la ruta) ──

export interface TutorMessage {
  role: "user" | "tutor";
  content: string;
}

/** Una conversación (thread) del tutor: varias por (usuario, ruta), cada una
 *  con su propio contexto, para manejar varios temas en paralelo. */
export interface TutorThread {
  id: string;
  title: string;
  updatedAt: string;
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

// Tipos de fuente que el usuario puede pedirle a la IA que busque en la web.
// Dan granularidad a "IA busca las mejores fuentes": el usuario acota qué clase
// de material quiere (libros, papers, video...) antes de la búsqueda con grounding.
export const SOURCE_TYPES = [
  { id: "libros",        label: "Libros" },
  { id: "papers",        label: "Papers académicos" },
  { id: "conferencias",  label: "Conferencias / video" },
  { id: "articulos",     label: "Artículos divulgativos" },
  { id: "documentacion", label: "Documentación oficial" },
] as const;

export type SourceTypeId = (typeof SOURCE_TYPES)[number]["id"];

/** Una fuente real descubierta por la búsqueda web con grounding de la IA. */
export interface DiscoveredSource {
  title: string;
  url: string;
  type: SourceTypeId;
  why: string; // 1 línea: por qué es buena fuente (autoridad/calidad)
}

export interface PlanState {
  plan: Plan;
  /** Balance de créditos del usuario (route_quota). */
  routeQuota: number;
  /** Nº de rutas creadas (conteo). */
  routesUsed: number;
  /** Créditos consumidos = suma del costo de cada ruta creada. */
  creditsUsed: number;
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
  // Gamificación de escucha/recorrido (global por usuario; nivel derivado)
  /** Tiempo total escuchado en modo Podcast (segundos). */
  podcastSeconds: number;
  /** Lecciones/estaciones del Túnel completadas en total. */
  tunnelLessons: number;
  /** Tiempo total visto en Modo Scroll (segundos). */
  scrollSeconds: number;
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
  /** Estado de los cortos del Modo Scroll de esta ruta. */
  videosEstado: VideosEstado;
  /** true si el creador integró los cortos en el estudio de la lección. */
  cortosIntegrados: boolean;
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
  /** Aviso/error de generación: en `error` = motivo; en `ready` = aviso de recorte. */
  genNotice: string | null;
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
  /** Corto del Modo Scroll, presente solo si la ruta tiene los cortos
   *  integrados (routes.cortos_integrados) y este timeline está listo. */
  timeline: LessonTimeline | null;
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

/** Borrador de progreso de una microlección, para reanudar donde se dejó.
 *  Captura el paso actual + los acumuladores necesarios para puntuar bien. */
export interface MicroLessonProgress {
  phase: "audio" | "steps";
  currentStep: number;
  lives: number;
  xpTotal: number;
  attention: { correct: number; total: number };
  socraticScores: number[];
  quizCorrect: boolean;
  masteryUpdates: Array<{ conceptId: string; delta: number }>;
}
