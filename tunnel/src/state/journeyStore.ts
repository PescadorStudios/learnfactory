// ============================================================================
// EL MOTOR DE ESTADO — Capa 4.
// ----------------------------------------------------------------------------
// Fase 1: fase del viaje, catálogo, selección y riel ensamblado.
// Fase 2 añade el estado de TRAVESÍA: decisiones en los forks, velocidad de
// scroll (input), progreso (output del rig de cámara) y modo reduced-motion.
// El render lee de aquí; el rig de cámara escribe progreso/forks aquí.
// ============================================================================

import { create } from "zustand";
import type { Lesson, LessonSummary } from "../types/contract";
import type { Rail } from "../types/rail";
import { provider } from "../content";
import { assembleRail } from "../rail/assembleRail";

export type Phase = "lobby" | "tunnel";

type CatalogStatus = "idle" | "loading" | "ready" | "error";

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
}

const FRESH_TRAVERSAL = {
  choices: {} as Record<string, string>,
  scrollVelocity: 0,
  progressPct: 0,
  showForkPrompt: false,
  pendingForkId: null as string | null,
  atEnd: false,
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
}));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
