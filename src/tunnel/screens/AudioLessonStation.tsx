// ============================================================================
// ESTACIÓN DE LECCIÓN DE AUDIO — renderer del reto `audio_lesson` (Capa 3).
// ----------------------------------------------------------------------------
// La estación reproduce la lección REAL del nodo: un WAV continuo pregenerado
// (la misma narración Charon que /lesson) con una de las tres mecánicas de
// atención de la app (espía / subtítulos / co-piloto). Reutiliza el componente
// AttentionGame de Learn Factory SIN modificarlo: la app de siempre sigue igual.
//
// Patrón de audio idéntico a /lesson: IndexedDB primero (clave versionada por
// duración para no servir audio viejo), Storage como respaldo. Al terminar eleva
// el resultado (la estación muestra la recompensa); al salir, suelta el atraque
// sin bloquear el viaje.
// ============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import AttentionGame from "@/app/lesson/attention/AttentionGame";
import { getAudio, putAudio } from "@/lib/audioCache";
import type { ChallengeResult } from "../state/journeyStore";
import type { AudioLessonChallenge } from "../types/contract";

interface Props {
  challenge: AudioLessonChallenge;
  nodeTitle: string;
  onResult: (r: ChallengeResult) => void;
  onExit: () => void;
}

export function AudioLessonStation({ challenge, nodeTitle, onResult, onExit }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    const url = challenge.audioUrl;
    const ver = challenge.durationSeconds || 0;
    if (!url) {
      setStatus("error");
      return;
    }
    // Versión por duración: al regenerar cambia el audio pero la URL no, así que
    // versionamos la clave para no casar audio viejo con cues nuevos.
    const key = `tunnel_audio_${ver}_${url}`;
    if (fetchedFor.current === key) return;
    fetchedFor.current = key;

    let alive = true;
    (async () => {
      setStatus("loading");
      let b = await getAudio(key);
      if (!b) {
        try {
          const bust = `${url}${url.includes("?") ? "&" : "?"}v=${ver}`;
          const res = await fetch(bust, { cache: "no-store" });
          if (res.ok) {
            b = await res.blob();
            await putAudio(key, b);
          }
        } catch {
          b = null;
        }
      }
      if (!alive) return;
      setBlob(b);
      setStatus(b ? "ready" : "error");
    })();
    return () => {
      alive = false;
    };
  }, [challenge.audioUrl, challenge.durationSeconds]);

  if (status === "ready" && blob) {
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-zinc-950">
        <AttentionGame
          nodeTitle={nodeTitle}
          audioBlob={blob}
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

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-zinc-950 px-6 text-center text-white">
      {status === "loading" ? (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-cyan-400" />
          <p className="text-zinc-300">Cargando la lección…</p>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
