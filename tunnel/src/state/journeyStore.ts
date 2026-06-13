// ============================================================================
// EL MOTOR DE ESTADO — Capa 4.
// ----------------------------------------------------------------------------
// Fase 1: fase del viaje, catálogo, selección y riel ensamblado.
// Fase 2 añade el estado de TRAVESÍA: decisiones en los forks, velocidad de
// scroll (input), progreso (output del rig de cámara) y modo reduced-motion.
// Fase 3 añade el ATRAQUE a estaciones: en qué estación está atracada la cámara
// (reto en curso), qué estaciones ya se resolvieron y los datos capturados.
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
  /** Datos capturados en orden de visita (HUD/recap). */
  captured: Captured[];

  /** Accesibilidad: cámara estática, menos partículas, sin parallax. */
  reducedMotion: boolean;
  /** Alterna el mapa de debug (Capa 0) sobre el mundo 3D. */
  debugView: boolean;

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

  // --- Acciones de estaciones (Fase 3) ---
  /** El rig atraca la cámara en una estación al alcanzarla (lanza su reto). */
  dockStation: (stationId: string) => void;
  /** El reto terminó: marca la estación, captura su reward y suelta el atraque. */
  completeStation: (stationId: string, result: ChallengeResult) => void;
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
  captured: [] as Captured[],
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
      set({ rail, phase: "tunnel", assembling: false, ...FRESH_TRAVERSAL });
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

  dockStation(stationId) {
    const s = get();
    if (s.activeStationId || s.completed[stationId]) return;
    set({ activeStationId: stationId });
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
    set({
      completed: { ...s.completed, [stationId]: true },
      captured: [...s.captured, captured],
      activeStationId: null,
    });
  },
}));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
