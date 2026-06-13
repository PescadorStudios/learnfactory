// ============================================================================
// ESTACIÓN DE LECCIÓN DE AUDIO — renderer del reto `audio_lesson` (Capa 3).
// ----------------------------------------------------------------------------
// La estación reproduce la lección REAL del nodo: un WAV continuo pregenerado
// (la misma narración Charon que /lesson) con una de las tres mecánicas de
// atención de la app (espía / subtítulos / co-piloto). Reutiliza el componente
// AttentionGame de Learn Factory SIN modificarlo: la app de siempre sigue igual.
//
// Audio idéntico a /lesson: STREAMING directo desde Storage. El navegador lo
// descarga progresivamente (por rangos) y la reproducción arranca sin esperar
// los ~8 MB completos — no hay descarga bloqueante. (?v= versiona por duración
// para no casar audio viejo con cues nuevos.) Al terminar eleva el resultado (la
// estación muestra la recompensa); al salir, suelta el atraque sin bloquear.
// ============================================================================

"use client";

import AttentionGame from "@/app/lesson/attention/AttentionGame";
import type { ChallengeResult } from "../state/journeyStore";
import type { AudioLessonChallenge } from "../types/contract";

interface Props {
  challenge: AudioLessonChallenge;
  nodeTitle: string;
  onResult: (r: ChallengeResult) => void;
  onExit: () => void;
}

export function AudioLessonStation({ challenge, nodeTitle, onResult, onExit }: Props) {
  const url = challenge.audioUrl;
  const ver = challenge.durationSeconds || 0;
  const audioSrc = url ? `${url}${url.includes("?") ? "&" : "?"}v=${ver}` : "";

  if (!audioSrc) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-zinc-950 px-6 text-center text-white">
        <p className="max-w-sm text-zinc-300">
          No se pudo cargar el audio de esta lección. Puedes seguir el viaje.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="rounded-2xl bg-cyan-500 px-7 py-3 font-bold text-zinc-950 transition hover:bg-cyan-400"
        >
          Seguir el viaje →
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-zinc-950">
      <AttentionGame
        nodeTitle={nodeTitle}
        audioSrc={audioSrc}
        attention={challenge.attention}
        durationSeconds={challenge.durationSeconds}
        onFinish={(correct, total) => {
          // Umbral suave: el reward se captura igual; esto afina el veredicto.
          const success = total > 0 ? correct >= Math.ceil(total * 0.6) : true;
          onResult({ success, score: correct, total });
        }}
        onExit={onExit}
      />
    </div>
  );
}
