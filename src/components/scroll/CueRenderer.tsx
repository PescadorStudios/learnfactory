"use client";

// Renderiza el cue ACTIVO de un timeline contra el tiempo actual del audio.
// Cambia de componente con crossfade (AnimatePresence). El `key={idx}` fuerza el
// re-montaje al cambiar de cue, lo que dispara las animaciones de entrada.

import { AnimatePresence } from "framer-motion";
import type { TimelineCue } from "@/lib/types";
import { SCROLL_COMPONENTS } from "./vocab";

/** Índice del cue activo: el último cuyo start_ms ya pasó. -1 si no hay. */
export function activeCueIndex(cues: TimelineCue[], currentTimeMs: number): number {
  if (!cues.length) return -1;
  let idx = 0;
  for (let i = 0; i < cues.length; i++) {
    if (currentTimeMs >= cues[i].start_ms) idx = i;
    else break;
  }
  return idx;
}

export default function CueRenderer({
  cues,
  currentTimeMs,
}: {
  cues: TimelineCue[];
  currentTimeMs: number;
}) {
  const idx = activeCueIndex(cues, currentTimeMs);
  if (idx < 0) return null;

  const cue = cues[idx];
  const Comp = SCROLL_COMPONENTS[cue.componente];
  if (!Comp) return null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <AnimatePresence>
        <Comp key={idx} props={cue.props} durationMs={cue.end_ms - cue.start_ms} />
      </AnimatePresence>
    </div>
  );
}
