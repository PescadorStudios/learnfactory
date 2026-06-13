// ============================================================================
// EL MOTOR DE ESTADO — Capa 4 (semilla).
// ----------------------------------------------------------------------------
// En Fase 1 solo trackea: fase del viaje, catálogo, selección y el riel
// ensamblado. Las Fases 2-4 añadirán aquí velocidad, posición en el riel,
// decisiones de fork, capturas y score (sin cambiar las firmas de Capa 0).
// ============================================================================

import { create } from "zustand";
import type { Lesson, LessonSummary } from "../types/contract";
import type { Rail } from "../types/rail";
import { provider } from "../content";
import { assembleRail } from "../rail/assembleRail";

export type Phase = "lobby" | "rail";

type CatalogStatus = "idle" | "loading" | "ready" | "error";

interface JourneyState {
  phase: Phase;

  catalog: LessonSummary[];
  catalogStatus: CatalogStatus;

  /** Orden de selección = orden de carriles en el riel. */
  selectedIds: string[];

  rail: Rail | null;
  assembling: boolean;
  error: string | null;

  loadCatalog: () => Promise<void>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  startJourney: () => Promise<void>;
  backToLobby: () => void;
}

export const useJourney = create<JourneyState>((set, get) => ({
  phase: "lobby",
  catalog: [],
  catalogStatus: "idle",
  selectedIds: [],
  rail: null,
  assembling: false,
  error: null,

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
      set({ rail, phase: "rail", assembling: false });
    } catch (e) {
      set({ assembling: false, error: errMsg(e) });
    }
  },

  backToLobby() {
    set({ phase: "lobby", rail: null });
  },
}));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
