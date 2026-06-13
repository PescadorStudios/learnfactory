// ============================================================================
// EL MOTOR DE ESTADO — Capa 4.
// ----------------------------------------------------------------------------
// Fase 1: fase del viaje, catálogo, selección y riel ensamblado.
// Fase 2 añade el estado de TRAVESÍA: decisiones en los forks, velocidad de
// scroll (input), progreso (output del rig de cámara) y modo reduced-motion.
// Fase 3 añade el ATRAQUE a estaciones: en qué estación está atracada la cámara
// (reto en curso), qué estaciones ya se resolvieron y los datos capturados.
// Fase 4 añade BIOFEEDBACK y NARRADOR: una energía 0-1 que sube al acertar y baja
// al fallar (el mundo la lee y reacciona), la racha de aciertos y la frase
// reactiva del narrador. Sigue agnóstico: energía/racha/frase son DESEMPEÑO, no
// contenido — nada temático entra aquí.
// El render lee de aquí; el rig de cámara escribe progreso/forks/atraque aquí.
// ============================================================================

import { create } from "zustand";
import type { Lesson, LessonSummary } from "../types/contract";
import type { Rail } from "../types/rail";
import { provider } from "../content";
import { assembleRail } from "../rail/assembleRail";

export type Phase = "lobby" | "tunnel";

type CatalogStatus = "idle" | "loading" | "ready" | "error";

/** Resultado de un reto. El `reward` se captura siempre; esto afina el veredicto. */
export interface ChallengeResult {
  /** ¿Superó el reto? (afina veredicto/scoring; el reward se captura igual). */
  success: boolean;
  /** Aciertos: trampas cazadas / impostor acertado. */
  score: number;
  /** Máximo posible. */
  total: number;
}

/** Un micro-dato capturado en una estación (alimenta HUD y recap). */
export interface Captured {
  id: string;
  title: string;
  niche?: string;
  reward: string;
  success: boolean;
}

/** Tono del narrador (define color/glow de la frase). Agnóstico al tema. */
export type NarrationTone = "calm" | "good" | "bad" | "streak";

/** Frase reactiva del narrador. `id` incremental → la UI re-anima cada frase. */
export interface Narration {
  text: string;
  tone: NarrationTone;
  id: number;
}

interface JourneyState {
  phase: Phase;

  catalog: LessonSummary[];
  catalogStatus: CatalogStatus;

  /** Orden de selección = orden de carriles (venas) en el riel. */
  selectedIds: string[];

  rail: Rail | null;
  assembling: boolean;
  error: string | null;

  // --- Travesía (Fase 2) ---
  /** forkNodeId → edgeId elegido. El path activo se deriva de esto. */
  choices: Record<string, string>;
  /** Input: velocidad de scroll suavizada por lenis (px/tick, con signo). */
  scrollVelocity: number;
  /** Output del rig: progreso 0-100 a lo largo del path activo. */
  progressPct: number;
  /** El rig pide decisión al acercarse a un fork. */
  showForkPrompt: boolean;
  pendingForkId: string | null;
  /** Llegó al final del trayecto. */
  atEnd: boolean;

  // --- Estaciones / retos (Fase 3) ---
  /** stationId → reto resuelto (su reward ya fue capturado). */
  completed: Record<string, boolean>;
  /** Estación en la que la cámara está atracada (reto en curso); null = viajando. */
  activeStationId: string | null;
  /** Vuelo libre: estación más cercana a la cámara (candidata a "Entrar"). */
  nearestStationId: string | null;
  /** Vuelo libre: ¿la cámara está cerca y lo bastante quieta para entrar? */
  canEnter: boolean;
  /** Datos capturados en orden de visita (HUD/recap). */
  captured: Captured[];

  // --- Biofeedback / narrador (Fase 4) ---
  /** Energía 0-1: sube al acertar, baja al fallar. El mundo la lee y reacciona. */
  energy: number;
  /** Aciertos consecutivos (se reinicia al fallar). */
  streak: number;
  /** Mejor racha del trayecto (para el recap). */
  bestStreak: number;
  /** Última frase del narrador (transient; la UI la desvanece). */
  narration: Narration | null;

  /** Accesibilidad: cámara estática, menos partículas, sin parallax. */
  reducedMotion: boolean;
  /** Alterna el mapa de debug (Capa 0) sobre el mundo 3D. */
  debugView: boolean;
  /** Voz (TTS) de los subtítulos silenciada. Preferencia global del viaje. */
  muted: boolean;

  // --- Acciones de catálogo / selección ---
  loadCatalog: () => Promise<void>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  startJourney: () => Promise<void>;
  backToLobby: () => void;

  // --- Acciones de travesía ---
  commitFork: (forkNodeId: string, edgeId: string) => void;
  setScrollVelocity: (v: number) => void;
  setReducedMotion: (b: boolean) => void;
  setProgress: (pct: number) => void;
  setForkPrompt: (show: boolean, pendingForkId: string | null) => void;
  setAtEnd: (b: boolean) => void;
  toggleDebug: () => void;
  toggleMuted: () => void;

  // --- Acciones de estaciones (Fase 3) ---
  /** El rig atraca la cámara en una estación al alcanzarla (lanza su reto). */
  dockStation: (stationId: string) => void;
  /** El reto terminó: marca la estación, captura su reward y suelta el atraque. */
  completeStation: (stationId: string, result: ChallengeResult) => void;

  // --- Vuelo libre (Fase B) ---
  /** El rig reporta la estación más cercana y si la cámara puede entrar ya. */
  setNearest: (id: string | null, canEnter: boolean) => void;
  /** Entra (o RE-entra) a una estación y monta su reto. Re-entrable. */
  enterStation: (stationId: string) => void;
  /** Sale de una estación SIN completarla (no la "quema": se puede volver). */
  exitStation: () => void;
  /** Finaliza el viaje a voluntad: dispara el Recap. */
  finishJourney: () => void;
  /** Cierra el Recap y sigue explorando la red. */
  resumeJourney: () => void;

  // --- Narrador (Fase 4) ---
  /** Emite una frase del narrador; la Capa 3 la muestra un instante. */
  narrate: (text: string, tone: NarrationTone) => void;
}

const FRESH_TRAVERSAL = {
  choices: {} as Record<string, string>,
  scrollVelocity: 0,
  progressPct: 0,
  showForkPrompt: false,
  pendingForkId: null as string | null,
  atEnd: false,
  completed: {} as Record<string, boolean>,
  activeStationId: null as string | null,
  nearestStationId: null as string | null,
  canEnter: false,
  captured: [] as Captured[],
  energy: 0.5,
  streak: 0,
  bestStreak: 0,
  narration: null as Narration | null,
};

export const useJourney = create<JourneyState>((set, get) => ({
  phase: "lobby",
  catalog: [],
  catalogStatus: "idle",
  selectedIds: [],
  rail: null,
  assembling: false,
  error: null,

  ...FRESH_TRAVERSAL,
  reducedMotion: false,
  debugView: false,
  muted: false,

  async loadCatalog() {
    if (get().catalogStatus === "loading") return;
    set({ catalogStatus: "loading", error: null });
    try {
      const catalog = await provider.listLessons();
      set({ catalog, catalogStatus: "ready" });
    } catch (e) {
      set({ catalogStatus: "error", error: errMsg(e) });
    }
  },

  toggleSelect(id) {
    const { selectedIds } = get();
    set({
      selectedIds: selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    });
  },

  clearSelection() {
    set({ selectedIds: [] });
  },

  async startJourney() {
    const { selectedIds, assembling } = get();
    if (assembling || selectedIds.length === 0) return;
    set({ assembling: true, error: null });
    try {
      // Capa 0: pide cada lección y ensambla el grafo del riel en runtime.
      const lessons: Lesson[] = await Promise.all(
        selectedIds.map((id) => provider.getLesson(id))
      );
      const rail = assembleRail(lessons);
      set({
        rail,
        phase: "tunnel",
        assembling: false,
        ...FRESH_TRAVERSAL,
        // El narrador abre el viaje (frase agnóstica: sobre el trance, no el tema).
        narration: { text: WELCOME, tone: "calm", id: 1 },
      });
    } catch (e) {
      set({ assembling: false, error: errMsg(e) });
    }
  },

  backToLobby() {
    set({ phase: "lobby", rail: null, debugView: false, ...FRESH_TRAVERSAL });
  },

  commitFork(forkNodeId, edgeId) {
    set((s) => ({
      choices: { ...s.choices, [forkNodeId]: edgeId },
      showForkPrompt: false,
      pendingForkId: null,
      atEnd: false,
    }));
    // El narrador confirma la elección (evento raro → un render extra es inocuo).
    get().narrate(pick(FORK_LINES), "calm");
  },

  setScrollVelocity(v) {
    set({ scrollVelocity: v });
  },
  setReducedMotion(b) {
    set({ reducedMotion: b });
  },
  setProgress(pct) {
    if (get().progressPct !== pct) set({ progressPct: pct });
  },
  setForkPrompt(show, pendingForkId) {
    const s = get();
    if (s.showForkPrompt !== show || s.pendingForkId !== pendingForkId) {
      set({ showForkPrompt: show, pendingForkId });
    }
  },
  setAtEnd(b) {
    if (get().atEnd !== b) set({ atEnd: b });
  },
  toggleDebug() {
    set((s) => ({ debugView: !s.debugView }));
  },
  toggleMuted() {
    set((s) => ({ muted: !s.muted }));
  },

  dockStation(stationId) {
    const s = get();
    if (s.activeStationId || s.completed[stationId]) return;
    set({ activeStationId: stationId });
  },

  setNearest(id, canEnter) {
    const s = get();
    if (s.nearestStationId !== id || s.canEnter !== canEnter) {
      set({ nearestStationId: id, canEnter });
    }
  },

  enterStation(stationId) {
    if (get().activeStationId) return;
    set({ activeStationId: stationId, canEnter: false });
  },

  exitStation() {
    if (get().activeStationId) set({ activeStationId: null });
  },

  finishJourney() {
    if (!get().atEnd) set({ atEnd: true });
  },

  resumeJourney() {
    if (get().atEnd) set({ atEnd: false });
  },

  completeStation(stationId, result) {
    const s = get();
    if (s.completed[stationId]) {
      if (s.activeStationId) set({ activeStationId: null });
      return;
    }
    // El reward sale del grafo (Capa 0), no de la UI: el motor sigue agnóstico.
    const node = s.rail?.nodes.find((n) => n.id === stationId);
    const captured: Captured = {
      id: stationId,
      title: node?.title ?? "Estación",
      niche: node?.niche,
      reward: node?.pod?.reward ?? "",
      success: result.success,
    };

    // Biofeedback: la energía sube al acertar (más si fue limpio) y baja al fallar.
    // La racha premia aciertos seguidos. El mundo lee `energy` y reacciona.
    const ratio =
      result.total > 0 ? result.score / result.total : result.success ? 1 : 0;
    const streak = result.success ? s.streak + 1 : 0;
    const bestStreak = Math.max(s.bestStreak, streak);
    let energy = s.energy + (result.success ? 0.16 + 0.1 * ratio : -0.18 + 0.05 * ratio);
    if (streak >= 3) energy += 0.05; // racha alta: el túnel se enciende
    energy = Math.max(0.12, Math.min(1, energy));

    // Narrador reactivo (agnóstico: habla del desempeño, no del tema).
    const tone: NarrationTone = result.success
      ? streak >= 3
        ? "streak"
        : "good"
      : "bad";
    const text = result.success
      ? streak >= 3
        ? `Racha ×${streak} · el túnel arde contigo.`
        : pick(GOOD_LINES)
      : pick(BAD_LINES);

    set({
      completed: { ...s.completed, [stationId]: true },
      captured: [...s.captured, captured],
      activeStationId: null,
      energy,
      streak,
      bestStreak,
      narration: { text, tone, id: (s.narration?.id ?? 0) + 1 },
    });
  },

  narrate(text, tone) {
    set((s) => ({ narration: { text, tone, id: (s.narration?.id ?? 0) + 1 } }));
  },
}));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- Copia del narrador (Capa 3 lo muestra). Agnóstico: habla del desempeño y del
//     "trance", nunca del tema. Cambiar estas frases no toca el motor. -----------
const WELCOME = "Respira. Déjate llevar por la corriente.";

const GOOD_LINES = [
  "Lo cazaste. La corriente se aviva.",
  "Bien visto. Tu mente se ilumina.",
  "Eso es. La sinapsis chispea.",
];

const BAD_LINES = [
  "Se escapó. La corriente titila.",
  "Esta vez no. El pulso se atenúa.",
];

const FORK_LINES = [
  "Tu instinto elige el camino.",
  "Esa corriente te llama. Síguela.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
