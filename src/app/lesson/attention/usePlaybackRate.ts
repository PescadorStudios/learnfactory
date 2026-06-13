"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

// Velocidades del podcast. Ciclo: 1× → 1.5× → 2× → 1×.
export const RATES = [1, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];

const STORAGE_KEY = "lf:playbackRate";

function isRate(v: number): v is Rate {
  return (RATES as readonly number[]).includes(v);
}

/**
 * Control de velocidad de reproducción para el `<audio>` de las mecánicas.
 * - Persiste la preferencia (localStorage) para que se mantenga entre lecciones.
 * - Reaplica `playbackRate` en `loadedmetadata`/`play`: algunos navegadores lo
 *   resetean a 1 al (re)cargar el medio o al reproducir.
 * - `preservesPitch = true` → la voz suena natural a 1.5×/2× (sin tono "ardilla").
 * Anclar la sincronía al `currentTime` (tiempo de medios) hace que subtítulos,
 * checkpoints y misiones sigan cuadrando sea cual sea la velocidad.
 */
export function usePlaybackRate(audioRef: RefObject<HTMLAudioElement | null>) {
  const [rate, setRate] = useState<Rate>(1);

  // Cargar preferencia guardada (solo cliente).
  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (isRate(saved)) setRate(saved);
  }, []);

  // Aplicar y mantener aplicada la velocidad sobre el elemento de audio.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const apply = () => {
      a.playbackRate = rate;
      try {
        a.preservesPitch = true;
        // Prefijos heredados de navegadores antiguos.
        (a as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
        (a as unknown as { mozPreservesPitch?: boolean }).mozPreservesPitch = true;
      } catch {
        /* preservesPitch no soportado: la velocidad funciona igual */
      }
    };
    apply();
    a.addEventListener("loadedmetadata", apply);
    a.addEventListener("play", apply);
    return () => {
      a.removeEventListener("loadedmetadata", apply);
      a.removeEventListener("play", apply);
    };
  }, [rate, audioRef]);

  const cycle = useCallback(() => {
    setRate((r) => {
      const next = RATES[(RATES.indexOf(r) + 1) % RATES.length];
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* almacenamiento no disponible: la velocidad funciona igual */
      }
      return next;
    });
  }, []);

  return { rate, cycle };
}
