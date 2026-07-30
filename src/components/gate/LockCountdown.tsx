"use client";

// Reloj en vivo del bloqueo de sesión. No existía ningún contador en el repo;
// el patrón de setInterval(…,1000) se toma de src/app/lesson/attention/SpyGame.tsx.

import { useEffect, useRef, useState } from "react";
import { formatCountdown, lockState } from "@/lib/sessionBudget";

export default function LockCountdown({
  until,
  onElapsed,
  className = "",
}: {
  /** ISO del momento en que se levanta el bloqueo. */
  until: string | null;
  /** Se llama UNA vez cuando el tiempo se cumple. */
  onElapsed?: () => void;
  className?: string;
}) {
  const [label, setLabel] = useState(() => formatCountdown(lockState(until).msLeft));
  // En un ref para que cambiar el callback no reinicie el intervalo (se
  // sincroniza en un efecto: escribir un ref durante el render no es válido).
  const elapsedCb = useRef(onElapsed);
  useEffect(() => {
    elapsedCb.current = onElapsed;
  }, [onElapsed]);

  useEffect(() => {
    let fired = false;

    const tick = () => {
      const { msLeft } = lockState(until);
      setLabel(formatCountdown(msLeft));
      if (msLeft <= 0 && !fired) {
        fired = true;
        elapsedCb.current?.();
      }
    };

    tick();
    const id = setInterval(tick, 1000);

    // Los navegadores estrangulan los timers de las pestañas en segundo plano a
    // ≥1 min, así que al volver el reloj estaría congelado: se recalcula al
    // recuperar visibilidad.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [until]);

  return <span className={`tabular-nums ${className}`}>{label || "0m 00s"}</span>;
}
