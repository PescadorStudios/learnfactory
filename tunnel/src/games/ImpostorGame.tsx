// ============================================================================
// EL IMPOSTOR — reto de detección (Capa 3).
// ----------------------------------------------------------------------------
// Se muestran N datos; exactamente uno es falso (el "impostor"). El viajero lo
// señala antes de que se acabe el tiempo (timeoutMs). Acierto = success; el
// reward se captura igual (modo ocio: siempre te llevas el dato). Las cartas se
// barajan para que el falso no caiga siempre en la misma posición.
// Agnóstico: solo lee `ImpostorChallenge`; nada temático aquí.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type { ImpostorChallenge } from "../types/contract";
import type { ChallengeResult } from "../state/journeyStore";

interface Card {
  text: string;
  isFalse: boolean;
  key: number;
}

export function ImpostorGame({
  challenge,
  color,
  onResult,
}: {
  challenge: ImpostorChallenge;
  color: string;
  onResult: (r: ChallengeResult) => void;
}) {
  const cards = useMemo<Card[]>(
    () => shuffle(challenge.facts.map((f, i) => ({ ...f, key: i }))),
    [challenge]
  );

  const [picked, setPicked] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(challenge.timeoutMs);
  const doneRef = useRef(false);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  function finish(chosenKey: number | null) {
    if (doneRef.current) return;
    doneRef.current = true;
    setPicked(chosenKey);
    const chosen = chosenKey == null ? null : cards.find((c) => c.key === chosenKey);
    const success = !!chosen?.isFalse;
    // Deja ver el reveal un momento antes de pasar al reward.
    window.setTimeout(
      () => cbRef.current({ success, score: success ? 1 : 0, total: 1 }),
      1400
    );
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Cuenta atrás (rAF). Al agotarse sin elegir = fallo.
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      if (doneRef.current) return;
      const left = Math.max(0, challenge.timeoutMs - (performance.now() - start));
      setTimeLeft(left);
      if (left <= 0) {
        finishRef.current(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [challenge.timeoutMs]);

  // Teclas 1-9 para señalar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= cards.length) {
        finishRef.current(cards[n - 1].key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cards]);

  const revealed = picked != null || timeLeft <= 0;
  const pct = Math.max(0, Math.min(1, timeLeft / challenge.timeoutMs));
  const urgent = !revealed && timeLeft <= challenge.timeoutMs * 0.33;

  return (
    <div className="game game--impostor">
      <p className="game__prompt">¿Cuál es el impostor?</p>
      <p className="game__hint muted small">
        Un dato es falso. Señálalo antes de que se acabe el tiempo.
      </p>

      <div className={`timer ${urgent ? "is-urgent" : ""}`} aria-hidden>
        <span
          className="timer__bar"
          style={{ width: `${pct * 100}%`, background: urgent ? undefined : color }}
        />
      </div>

      <ul className="facts">
        {cards.map((c, i) => {
          const isPick = picked === c.key;
          const state = !revealed
            ? "idle"
            : c.isFalse
              ? "false"
              : isPick
                ? "wrong"
                : "true";
          return (
            <li key={c.key}>
              <button
                type="button"
                className={`fact fact--${state}`}
                disabled={revealed}
                onClick={() => finishRef.current(c.key)}
                style={!revealed ? { borderColor: `${color}40` } : undefined}
              >
                <span className="fact__num">{i + 1}</span>
                <span className="fact__text">{c.text}</span>
                {revealed && c.isFalse && <span className="fact__tag">impostor</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
