// ============================================================================
// RECAP — la salida del túnel (Capa 3, Fase 5).
// ----------------------------------------------------------------------------
// Pantalla final compartible. Resume el viaje desde lo CAPTURADO (Capa 4): datos
// recogidos, aciertos, mejor racha y los nichos visitados. El "grado" se deriva
// del DESEMPEÑO (ratio de aciertos + racha), no del tema — agnóstico: el texto
// habla de cómo te fue, nunca de Roma/Célula/Finanzas. Compartir usa la Web Share
// API con fallback a portapapeles; si nada está disponible, degrada en silencio.
//
// Nota: aún no hay URL desplegada, así que el texto a compartir no inventa un
// enlace. Cuando exista, este es el único punto donde añadirlo.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { useJourney } from "../state/journeyStore";
import { stopVoice } from "../audio/voice";

type ShareState = "idle" | "shared" | "copied" | "error";

export function Recap() {
  const captured = useJourney((s) => s.captured);
  const bestStreak = useJourney((s) => s.bestStreak);
  const backToLobby = useJourney((s) => s.backToLobby);
  const [shareState, setShareState] = useState<ShareState>("idle");

  // Al llegar al recap, corta cualquier voz que siguiera sonando.
  useEffect(() => stopVoice(), []);

  const { total, aciertos, ratio, niches } = useMemo(() => {
    const total = captured.length;
    const aciertos = captured.filter((c) => c.success).length;
    const ratio = total > 0 ? aciertos / total : 0;
    const niches = Array.from(
      new Set(captured.map((c) => c.niche).filter(Boolean) as string[])
    );
    return { total, aciertos, ratio, niches };
  }, [captured]);

  const grade = useMemo(() => gradeFor(ratio, bestStreak), [ratio, bestStreak]);

  const shareText = useMemo(() => {
    const nichePart = niches.length > 0 ? ` (${niches.join(" · ")})` : "";
    const streakPart = bestStreak >= 2 ? `, racha de ${bestStreak}` : "";
    return (
      `Viajé por El Túnel de Learn Factory${nichePart}: capturé ${total} ` +
      `${total === 1 ? "dato" : "datos"}, ${aciertos} ` +
      `${aciertos === 1 ? "acierto" : "aciertos"}${streakPart} — ` +
      `aprendí sin sentir que estudiaba. 🧠✨`
    );
  }, [niches, total, aciertos, bestStreak]);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "El Túnel — Learn Factory", text: shareText });
        setShareState("shared");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        setShareState("copied");
        return;
      }
      setShareState("error");
    } catch {
      // El usuario canceló el diálogo, o falló: no es un error fatal — vuelve a idle.
      setShareState("idle");
    }
  }

  return (
    <div className="end-card recap">
      <p className="kicker">Fin del trayecto</p>
      <h2 className="recap__title">{grade.title}</h2>
      <p className="muted small recap__grade">{grade.line}</p>

      {total > 0 && (
        <>
          <div className="recap__stats">
            <span className="recap__stat">
              <strong>{total}</strong> {total === 1 ? "dato" : "datos"}
            </span>
            <span className="recap__stat">
              <strong>{aciertos}</strong>/{total} aciertos
            </span>
            {bestStreak >= 2 && (
              <span className="recap__stat recap__stat--streak">
                mejor racha ⚡×{bestStreak}
              </span>
            )}
          </div>

          {niches.length > 0 && (
            <div className="recap__niches">
              {niches.map((n) => (
                <span key={n} className="recap__niche">
                  {n}
                </span>
              ))}
            </div>
          )}

          <ul className="end-card__caps recap__caps">
            {captured.slice(-4).map((c) => (
              <li key={c.id}>
                <span aria-hidden>{c.success ? "✓" : "·"}</span> {c.reward}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="end-card__btns recap__btns">
        <button type="button" className="cta" onClick={share}>
          {shareState === "copied"
            ? "✓ Copiado al portapapeles"
            : shareState === "shared"
            ? "✓ Compartido"
            : shareState === "error"
            ? "No se pudo compartir"
            : "Compartir mi viaje"}
        </button>
        <button type="button" className="ghost" onClick={backToLobby}>
          Volver al lobby
        </button>
      </div>
    </div>
  );
}

// Grado del viaje: solo desempeño (ratio de aciertos + mejor racha). Agnóstico al
// tema — cambiar estas frases no toca el motor.
function gradeFor(
  ratio: number,
  bestStreak: number
): { title: string; line: string } {
  if (ratio >= 0.85 && bestStreak >= 3)
    return {
      title: "Mente en plena sintonía",
      line: "La corriente ardió contigo de principio a fin.",
    };
  if (ratio >= 0.6)
    return {
      title: "Buen instinto",
      line: "Cazaste más de lo que se te escapó.",
    };
  if (ratio >= 0.3)
    return {
      title: "Explorador curioso",
      line: "Te llevaste datos sin sentir que estudiabas.",
    };
  return {
    title: "Apenas calentando",
    line: "El túnel te espera para otra vuelta.",
  };
}
