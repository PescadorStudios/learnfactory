// ============================================================================
// CONTROLES DE VUELO — input del piloto para la navegación libre.
// ----------------------------------------------------------------------------
// Filosofía (pedido del usuario): la cámara SOLO anda cuando el piloto la pone en
// movimiento, y con INERCIA. Por eso el input es "mantener para volar":
//   • Arrastrar (ratón o táctil, idéntico): vertical = acelerador (arriba = avanzar,
//     abajo = retroceder), horizontal = rumbo (izq/der para cambiar de vena).
//   • Teclado: W/↑ y S/↓ = acelerador; A/← y D/→ = rumbo.
// Al soltar, throttle/steer vuelven a 0 y el rig deja que la velocidad se apague
// sola (momentum). Nunca avanza por su cuenta. Se escribe en un ref (sin re-render).
//
// Mientras hay una estación atracada (lección en curso) el input se ignora: la
// lección tiene su propia UI por encima del canvas.
// ============================================================================

import { useEffect, useRef } from "react";
import { useJourney } from "../state/journeyStore";

export interface FlyInput {
  /** −1..1 — acelerador con signo (adelante / atrás). */
  throttle: number;
  /** −1..1 — rumbo lateral (izquierda / derecha) para elegir vena en los cruces. */
  steer: number;
  /** El piloto está conduciendo ahora mismo (tecla pulsada o arrastrando). */
  active: boolean;
}

const DRAG_RANGE = 120; // px de arrastre para empuje máximo (menor = más responsivo)
const FLY_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];

export function useFlyControls(enabled: boolean) {
  const input = useRef<FlyInput>({ throttle: 0, steer: 0, active: false });

  useEffect(() => {
    if (!enabled) return;

    const keys = new Set<string>();
    let kbThrottle = 0;
    let kbSteer = 0;
    let dragThrottle = 0;
    let dragSteer = 0;
    let dragging = false;
    let sx = 0;
    let sy = 0;

    const clamp = (v: number) => Math.max(-1, Math.min(1, v));

    const apply = () => {
      input.current.throttle = clamp(kbThrottle + dragThrottle);
      input.current.steer = clamp(kbSteer + dragSteer);
      input.current.active = dragging || keys.size > 0;
    };

    const recomputeKb = () => {
      kbThrottle =
        (keys.has("w") || keys.has("arrowup") ? 1 : 0) +
        (keys.has("s") || keys.has("arrowdown") ? -1 : 0);
      kbSteer =
        (keys.has("d") || keys.has("arrowright") ? 1 : 0) +
        (keys.has("a") || keys.has("arrowleft") ? -1 : 0);
      apply();
    };

    // Bloquea el input mientras hay una lección abierta o el Recap a la vista.
    const blocked = () => {
      const s = useJourney.getState();
      return s.activeStationId != null || s.atEnd;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (blocked()) return;
      const k = e.key.toLowerCase();
      if (!FLY_KEYS.includes(k)) return;
      if (k.startsWith("arrow")) e.preventDefault(); // no scrollear la página
      keys.add(k);
      recomputeKb();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (keys.delete(k)) recomputeKb();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (blocked()) return;
      const target = e.target as HTMLElement | null;
      // No iniciar vuelo al tocar HUD (botones, enlaces, prompts).
      if (target?.closest("button, a, input, [data-no-drag]")) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      dragThrottle = 0;
      dragSteer = 0;
      apply();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      dragThrottle = clamp(-(e.clientY - sy) / DRAG_RANGE); // arrastrar arriba = avanzar
      dragSteer = clamp((e.clientX - sx) / DRAG_RANGE);
      apply();
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      dragThrottle = 0;
      dragSteer = 0;
      apply();
    };
    const onBlur = () => {
      keys.clear();
      kbThrottle = 0;
      kbSteer = 0;
      endDrag();
      apply();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", onBlur);
      input.current = { throttle: 0, steer: 0, active: false };
    };
  }, [enabled]);

  return input;
}
