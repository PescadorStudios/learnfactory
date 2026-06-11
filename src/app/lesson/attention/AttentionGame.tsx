"use client";

import type { AttentionData } from "@/lib/types";
import SpyGame from "./SpyGame";
import SubtitleGame from "./SubtitleGame";
import CopilotGame from "./CopilotGame";

interface Props {
  nodeTitle: string;
  audioBlob: Blob;
  attention: AttentionData;
  durationSeconds: number;
  onFinish: (correct: number, total: number) => void;
  onExit: () => void;
}

/**
 * Dispatcher del sistema de verificación de atención: cada lección trae una
 * de las tres mecánicas (rotan en el backend: espía → subtítulos → co-piloto).
 */
export default function AttentionGame({ nodeTitle, audioBlob, attention, durationSeconds, onFinish, onExit }: Props) {
  const common = { nodeTitle, audioBlob, durationSeconds, onFinish, onExit };

  if (attention.mode === "subtitles") return <SubtitleGame {...common} data={attention} />;
  if (attention.mode === "copilot") return <CopilotGame {...common} data={attention} />;
  return <SpyGame {...common} data={attention} />;
}
