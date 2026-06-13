// ============================================================================
// RIG DE CÁMARA — convierte scroll→avance y mueve la cámara por la curva.
// ----------------------------------------------------------------------------
// • Velocidad objetivo = deriva base (trance) + |velocidad de scroll|, suavizada
//   por un resorte (inercia). Integra distancia recorrida sobre la curva.
// • Compuerta única = la próxima parada (gateDistance): la siguiente estación sin
//   resolver, o el final / nodo de fork si ya no quedan. La cámara FRENA al
//   acercarse (zona BRAKE_DIST) para atracar con suavidad, no de golpe.
// • Atraque: al llegar a una estación sin resolver, pide dockStation() al store;
//   la Capa 3 monta el reto. Mientras está atracada, la cámara queda quieta.
// • Tras resolver el reto el gate avanza a la próxima parada y la cámara reanuda.
// • Escribe progreso / fork / fin al store (solo cuando cambian) para que el HUD
//   reaccione sin re-render por frame. reduced-motion: sin balanceo ni roll.
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
const BRAKE_DIST = 7; // zona de frenado antes de una parada (atraque/fork/fin)
const DOCK_EPS = 0.6; // distancia a la que se considera "llegado" a la parada

export function CameraRig({
  curve,
  length,
  pendingFork,
  gateDistance,
  dockTargetId,
  startPos,
  rt,
}: {
  curve: THREE.CatmullRomCurve3 | null;
  length: number;
  pendingFork: RailFork | null;
  /** Distancia (sobre la curva) de la próxima parada. */
  gateDistance: number;
  /** Estación a atracar al llegar al gate; null si el gate es fork/fin. */
  dockTargetId: string | null;
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
    const docked = st.activeStationId != null;

    // Resorte de velocidad (inercia). Atracado: ignora el scroll y vuelve a la
    // deriva base, para que al soltar no salga disparada.
    const target = docked
      ? BASE_DRIFT
      : Math.min(MAX_SPEED, BASE_DRIFT + Math.abs(st.scrollVelocity) * SCROLL_K);
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
      // Avance con frenado suave al acercarse a la parada (gate).
      const gate = Math.min(gateDistance, length);
      let d = distRef.current;
      const brake = THREE.MathUtils.clamp((gate - d) / BRAKE_DIST, 0, 1);
      d += speedRef.current * dt * brake;
      if (d > gate) d = gate;
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

      // El balanceo se calma durante el atraque (foco en el reto).
      if (!st.reducedMotion && !docked) {
        const t = state.clock.elapsedTime;
        camera.position.x += Math.sin(t * 0.7) * 0.16;
        camera.position.y += Math.cos(t * 0.9) * 0.13;
        camera.rotateZ(Math.sin(t * 0.5) * 0.012);
      }

      pct = Math.round(u * 100);
      const atGate = gate - d < DOCK_EPS;
      if (atGate) {
        if (dockTargetId) {
          // Llegó a una estación sin resolver: atraca y lanza su reto.
          if (!st.activeStationId && !st.completed[dockTargetId]) {
            st.dockStation(dockTargetId);
          }
        } else if (pendingFork) {
          showPrompt = true;
        } else {
          atEnd = true;
        }
      }
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
