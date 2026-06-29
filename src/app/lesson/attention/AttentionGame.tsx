"use client";

import type { AttentionData, LessonTimeline } from "@/lib/types";
import SpyGame from "./SpyGame";
import SubtitleGame from "./SubtitleGame";
import CopilotGame from "./CopilotGame";

interface Props {
  nodeTitle: string;
  audioSrc: string;
  attention: AttentionData;
  durationSeconds: number;
  onFinish: (correct: number, total: number) => void;
  onExit: () => void;
  /** Corto del Modo Scroll integrado (si la ruta lo activó). */
  timeline?: LessonTimeline | null;
}

/**
 * Dispatcher del sistema de verificación de atención: cada lección trae una
 * de las tres mecánicas (rotan en el backend: espía → subtítulos → co-piloto).
 */
export default function AttentionGame({ nodeTitle, audioSrc, attention, durationSeconds, onFinish, onExit, timeline }: Props) {
  const common = { nodeTitle, audioSrc, durationSeconds, onFinish, onExit, timeline };

  if (attention.mode === "subtitles") return <SubtitleGame {...common} data={attention} />;
  if (attention.mode === "copilot") return <CopilotGame {...common} data={attention} />;
  return <SpyGame {...common} data={attention} />;
}
