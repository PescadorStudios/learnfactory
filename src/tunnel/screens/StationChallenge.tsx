// ============================================================================
// ESTACIÓN — anfitrión del reto (Capa 3, DOM sobre el canvas).
// ----------------------------------------------------------------------------
// La cámara está atracada en esta estación. Según el tipo de reto del pod
// (unión `Challenge`) monta su renderer; al terminar muestra el reward capturado
// y suelta el atraque (completeStation). AGNÓSTICO: el título, el nicho, el reto
// y el reward salen del grafo (Capa 0) — aquí no hay nada temático hardcodeado.
//
// 👉 Punto de extensión: para un reto nuevo, añade un miembro a la unión
//    `Challenge` (contract.ts) y un `case` aquí con su componente. El riel y el
//    motor no cambian.
// ============================================================================

import { useEffect, useState } from "react";
import { useJourney } from "../state/journeyStore";
import type { ChallengeResult } from "../state/journeyStore";
import { colorForNiche } from "../theme";
import { ImpostorGame } from "../games/ImpostorGame";
import { TrapSubtitlesGame } from "../games/TrapSubtitlesGame";
import { AudioLessonStation } from "./AudioLessonStation";
import type { RailNode } from "../types/rail";
import type { Challenge } from "../types/contract";

export function StationChallenge({ node }: { node: RailNode }) {
  const completeStation = useJourney((s) => s.completeStation);
  const [result, setResult] = useState<ChallengeResult | null>(null);

  const pod = node.pod;

  // Defensa: una estación sin pod soltaría el atraque en vez de bloquearlo.
  // (Por construcción las estaciones siempre traen pod; esto evita un soft-lock.)
  useEffect(() => {
    if (!pod) completeStation(node.id, { success: false, score: 0, total: 0 });
  }, [pod, node.id, completeStation]);

  if (!pod) return null;

  const color = node.niche ? colorForNiche(node.niche) : "#33e1ed";
  const challenge = pod.challenge;

  // Lección de audio real: pantalla completa con su propia mecánica (espía /
  // subtítulos / copiloto). Al terminar eleva el resultado → recompensa abajo;
  // al salir, suelta el atraque sin bloquear (skip = avanza sin recompensa).
  if (challenge.type === "audio_lesson" && !result) {
    return (
      <AudioLessonStation
        challenge={challenge}
        nodeTitle={pod.title}
        onResult={setResult}
        onExit={() => completeStation(node.id, { success: false, score: 0, total: 0 })}
      />
    );
  }

  return (
    <div className="station" role="dialog" aria-modal="true" aria-label={pod.title}>
      <div className="station__panel" style={{ borderColor: `${color}55` }}>
        <header className="station__head">
          {node.niche && (
            <span className="station__niche" style={{ color }}>
              {node.niche}
            </span>
          )}
          <h2 className="station__title">{pod.title}</h2>
        </header>

        {result ? (
          <div className="reward">
            <p className={`reward__verdict ${result.success ? "is-good" : "is-soft"}`}>
              {verdict(challenge.type, result)}
            </p>
            {result.total > 0 && (
              <p className="muted small">
                {result.score}/{result.total}
              </p>
            )}
            <div
              className="reward__capsule"
              style={{ borderColor: color, boxShadow: `0 0 32px -10px ${color}` }}
            >
              <span className="reward__label" style={{ color }}>
                Capturaste
              </span>
              <p className="reward__text">{pod.reward}</p>
            </div>
            <button
              type="button"
              className="cta"
              onClick={() => completeStation(node.id, result)}
            >
              Seguir el viaje →
            </button>
          </div>
        ) : (
          renderChallenge(challenge, color, setResult)
        )}
      </div>
    </div>
  );
}

/** Despacho exhaustivo sobre la unión de retos. */
function renderChallenge(
  challenge: Challenge,
  color: string,
  onResult: (r: ChallengeResult) => void
) {
  switch (challenge.type) {
    case "impostor":
      return <ImpostorGame challenge={challenge} color={color} onResult={onResult} />;
    case "trap_subtitles":
      return (
        <TrapSubtitlesGame challenge={challenge} color={color} onResult={onResult} />
      );
    case "audio_lesson":
      // Se renderiza a pantalla completa antes de llegar aquí (ver arriba); este
      // caso solo mantiene exhaustiva la unión para TypeScript.
      return null;
    default: {
      // Si añades un reto a la unión sin renderer, TypeScript marca aquí.
      const _exhaustive: never = challenge;
      return _exhaustive;
    }
  }
}

function verdict(type: Challenge["type"], r: ChallengeResult): string {
  if (r.success) {
    if (type === "impostor") return "¡Impostor desenmascarado!";
    if (type === "audio_lesson") return "¡Lección dominada!";
    return "¡Detector implacable!";
  }
  if (type === "impostor") return "Se te coló…";
  if (type === "audio_lesson") return "Repásala con calma…";
  return "Se te escaparon algunas…";
}
