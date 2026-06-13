// ============================================================================
// EL NARRADOR — micro-copy reactivo (Capa 3, DOM sobre el canvas).
// ----------------------------------------------------------------------------
// Lee la última frase del narrador del store (texto + tono) y la muestra un
// instante; luego se desvanece. El motor emite estas frases en eventos del viaje
// (entrada, resolver una estación, racha). Son sobre la EXPERIENCIA y el
// desempeño, no sobre el contenido: el narrador es agnóstico al tema.
//
// `key={shown.id}` re-monta la línea en cada frase nueva → la animación de
// entrada/salida vuelve a correr aunque el texto se repita.
// ============================================================================

import { useEffect, useState } from "react";
import { useJourney } from "../state/journeyStore";
import type { Narration } from "../state/journeyStore";

const HOLD_MS = 3600; // debe coincidir con la duración de la animación narratorLife

export function Narrator() {
  const narration = useJourney((s) => s.narration);
  const [shown, setShown] = useState<Narration | null>(narration);

  useEffect(() => {
    if (!narration) return;
    setShown(narration);
    const t = window.setTimeout(() => setShown(null), HOLD_MS);
    return () => window.clearTimeout(t);
  }, [narration]);

  if (!shown) return null;
  return (
    <div className={`narrator narrator--${shown.tone}`} aria-live="polite">
      <p key={shown.id} className="narrator__line">
        {shown.text}
      </p>
    </div>
  );
}
