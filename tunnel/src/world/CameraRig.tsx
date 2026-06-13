// ============================================================================
// RIG DE CÁMARA — convierte scroll→avance y mueve la cámara por la curva.
// ----------------------------------------------------------------------------
// • Velocidad objetivo = deriva base (trance) + |velocidad de scroll|, suavizada
//   por un resorte (inercia). Integra distancia recorrida sobre la curva.
// • Compuerta de fork: si hay un fork sin decidir, la cámara se detiene un poco
//   antes del nodo (HOVER_MARGIN) y "flota" hasta que el viajero elige.
// • Escribe progreso / estado de fork / fin al store (solo cuando cambian) para
//   que el HUD (Capa 3) reaccione sin re-render por frame.
// • reduced-motion: sin balanceo ni roll (anti-mareo).
// ============================================================================

import { useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useJourney } from "../state/journeyStore";
import type { RailFork } from "../types/rail";
import type { TunnelRuntime } from "./types";

const BASE_DRIFT = 3.6; // u/seg sin scroll (trance)
const SCROLL_K = 0.45; // cuánto acelera el scroll
const MAX_SPEED = 24;
const TAU = 0.5; // inercia: constante de tiempo del resorte (seg)
const HOVER_MARGIN = 3.2; // se detiene esta distancia antes del fork
const PROMPT_LEAD = 10; // a esta distancia del fork aparece el prompt

export function CameraRig({
  curve,
  length,
  pendingFork,
  startPos,
  rt,
}: {
  curve: THREE.CatmullRomCurve3 | null;
  length: number;
  pendingFork: RailFork | null;
  startPos: THREE.Vector3;
  rt: MutableRefObject<TunnelRuntime>;
}) {
  const { camera } = useThree();
  const distRef = useRef(0);
  const speedRef = useRef(BASE_DRIFT);
  const look = useRef(new THREE.Vector3());
  const prev = useRef({ pct: -1, prompt: false, end: false, forkId: null as string | null });

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useJourney.getState();

    // Resorte de velocidad (inercia): siempre se actualiza.
    const target = Math.min(
      MAX_SPEED,
      BASE_DRIFT + Math.abs(st.scrollVelocity) * SCROLL_K
    );
    speedRef.current += (target - speedRef.current) * (1 - Math.exp(-dt / TAU));
    rt.current.speed = speedRef.current;

    let pct = 0;
    let showPrompt = false;
    let atEnd = false;
    const forkId = pendingFork?.id ?? null;

    if (!curve || length <= 0) {
      // Antesala de START: aún no hay path. Se muestra el fork inicial enseguida.
      camera.position.set(startPos.x, startPos.y + 0.4, startPos.z - 6);
      look.current.set(startPos.x, startPos.y, startPos.z + 8);
      camera.up.set(0, 1, 0);
      camera.lookAt(look.current);
      rt.current.u = 0;
      rt.current.distance = 0;
      showPrompt = true;
    } else {
      let d = distRef.current + speedRef.current * dt;
      const maxD = pendingFork ? Math.max(0, length - HOVER_MARGIN) : length;
      if (d > maxD) d = maxD;
      if (d < 0) d = 0;
      distRef.current = d;

      const u = THREE.MathUtils.clamp(d / length, 0, 1);
      rt.current.u = u;
      rt.current.distance = d;

      const pos = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      look.current.copy(pos).add(tan);
      camera.up.set(0, 1, 0);
      camera.position.copy(pos);
      camera.lookAt(look.current);

      if (!st.reducedMotion) {
        const t = state.clock.elapsedTime;
        camera.position.x += Math.sin(t * 0.7) * 0.16;
        camera.position.y += Math.cos(t * 0.9) * 0.13;
        camera.rotateZ(Math.sin(t * 0.5) * 0.012);
      }

      pct = Math.round(u * 100);
      const atGate = d >= maxD - 0.05;
      showPrompt = !!pendingFork && d >= maxD - PROMPT_LEAD;
      atEnd = !pendingFork && atGate;
    }

    // Sincroniza al store solo cuando cambian valores discretos.
    const p = prev.current;
    if (p.pct !== pct) {
      st.setProgress(pct);
      p.pct = pct;
    }
    const sid = showPrompt ? forkId : null;
    if (p.prompt !== showPrompt || p.forkId !== sid) {
      st.setForkPrompt(showPrompt, sid);
      p.prompt = showPrompt;
      p.forkId = sid;
    }
    if (p.end !== atEnd) {
      st.setAtEnd(atEnd);
      p.end = atEnd;
    }
  });

  return null;
}
