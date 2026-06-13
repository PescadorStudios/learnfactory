// ============================================================================
// RIG DE CÁMARA — VUELO LIBRE sobre el plano de la red (Fase B, v2).
// ----------------------------------------------------------------------------
// La red es PLANA: las lecciones se reparten en carriles sobre X (un tema por
// carril) y en capas sobre Z (la profundidad de cada lección). Por eso navegar
// es volar en 2 ejes sobre ese plano — NO ir por un riel:
//   • Z (acelerador / arrastrar arriba-abajo): adentrarse o volver en profundidad.
//   • X (rumbo / arrastrar izq-der): CAMBIAR DE TEMA, deslizándose entre carriles.
// El movimiento tiene INERCIA y solo ocurre con input: al soltar conserva impulso
// y se detiene; sin input no hay deriva.
//
// La cámara va "en persecución": flota por encima y por detrás del punto de foco y
// SIEMPRE mira hacia +Z. Así "adelante" es siempre lo que falta por recorrer y el
// piloto nunca se desorienta (clave del pedido: saber dónde va y qué le falta).
//
// Escribe al store solo valores discretos: estación cercana (Entrar) y la posición
// en el plano (con dead-band) para el minimapa.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useJourney } from "../state/journeyStore";
import type { Rail } from "../types/rail";
import type { TunnelRuntime } from "./types";
import type { FlyInput } from "../hooks/useFlyControls";
import { buildNavGraph, nearestStation } from "./graphNav";

const SPEED = 16; // u/seg a fondo (en el plano)
const ACCEL_TAU = 0.16; // inercia al acelerar (resorte rápido)
const COAST_TAU = 0.55; // inercia al soltar (momentum hasta parar)
const STOP_EPS = 0.05; // por debajo, sin input, se detiene del todo
const TAU_E = 0.8; // suavizado de energía (biofeedback)

// Encuadre de la cámara de persecución (por encima y detrás del foco).
const HEIGHT = 6; // altura sobre el plano
const BACK = 8.5; // cuánto se queda por detrás del foco (−Z)
const LOOK_AHEAD = 7; // hacia dónde mira por delante del foco (+Z)
const LEAN = 0.14; // ladeo lateral con la velocidad en X (vida, no marea)

const ENTER_RADIUS = 3.6; // distancia en el plano para ofrecer "Entrar"
const ENTER_SPEED = 4.5; // velocidad por debajo de la cual se puede entrar
const FOCUS_DEADBAND = 1.25; // mueve el minimapa solo tras avanzar esto (mundo)

// Empuje cinematográfico con la velocidad ("salto cuántico"). reduced-motion-safe.
const FOV_KICK = 6; // grados extra de FOV a tope de velocidad (sensación de salto)
const FOV_TAU = 0.35; // suavizado del FOV
const FOG_TIGHTEN = 22; // cuánto se cierra la niebla (far) a tope de velocidad
const FOG_TAU = 0.5; // suavizado de la niebla

export function CameraRig({
  rail,
  input,
  rt,
}: {
  rail: Rail;
  input: MutableRefObject<FlyInput>;
  rt: MutableRefObject<TunnelRuntime>;
}) {
  const { camera } = useThree();
  const graph = useMemo(() => buildNavGraph(rail), [rail]);

  // Límites del plano (caja del grafo + margen lateral para encarar carriles extremos).
  const bounds = useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const n of rail.nodes) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x);
      minZ = Math.min(minZ, n.position.z);
      maxZ = Math.max(maxZ, n.position.z);
    }
    if (!isFinite(minX)) {
      minX = -5;
      maxX = 5;
      minZ = -5;
      maxZ = 5;
    }
    return { minX: minX - 2, maxX: maxX + 2, minZ, maxZ };
  }, [rail]);

  // Estado de vuelo (fuera de React: se integra cada frame).
  const fx = useRef(0);
  const fz = useRef(0);
  const vx = useRef(0);
  const vz = useRef(0);
  const focusV = useRef(new THREE.Vector3());
  const lookV = useRef(new THREE.Vector3());
  const lastFocus = useRef({ x: Infinity, z: Infinity });
  const prevNear = useRef<{ id: string | null; can: boolean }>({ id: null, can: false });
  const baseFov = useRef<number | null>(null); // FOV original del lienzo (se captura 1 vez)
  const baseFar = useRef<number | null>(null); // niebla far original (se captura 1 vez)

  // (Re)arranca centrado en la primera capa de estaciones al cambiar de grafo.
  useEffect(() => {
    fx.current = 0;
    fz.current = THREE.MathUtils.clamp(0, bounds.minZ, bounds.maxZ);
    vx.current = 0;
    vz.current = 0;
    lastFocus.current = { x: Infinity, z: Infinity };
    prevNear.current = { id: null, can: false };
  }, [bounds, graph]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useJourney.getState();
    const frozen = st.activeStationId != null || st.atEnd; // lección o Recap: quieta

    const thr = frozen ? 0 : input.current.throttle; // ↑/↓ → Z (profundidad)
    const str = frozen ? 0 : input.current.steer; // ←/→ → X (tema)

    // --- 1) Velocidad objetivo (empuje del piloto), limitada en magnitud. ---
    let tvx = str * SPEED;
    let tvz = thr * SPEED;
    const tmag = Math.hypot(tvx, tvz);
    if (tmag > SPEED) {
      const s = SPEED / tmag;
      tvx *= s;
      tvz *= s;
    }

    // --- 2) Inercia: resorte hacia el objetivo; al soltar, momentum → parar. ---
    const driving = Math.abs(thr) > 0.01 || Math.abs(str) > 0.01;
    const k = 1 - Math.exp(-dt / (driving ? ACCEL_TAU : COAST_TAU));
    vx.current += (tvx - vx.current) * k;
    vz.current += (tvz - vz.current) * k;
    if (!driving && Math.hypot(vx.current, vz.current) < STOP_EPS) {
      vx.current = 0;
      vz.current = 0;
    }

    // --- 3) Integrar el foco y mantenerlo dentro del plano (sin atascarse). ---
    fx.current += vx.current * dt;
    fz.current += vz.current * dt;
    if (fx.current <= bounds.minX) {
      fx.current = bounds.minX;
      if (vx.current < 0) vx.current = 0;
    } else if (fx.current >= bounds.maxX) {
      fx.current = bounds.maxX;
      if (vx.current > 0) vx.current = 0;
    }
    if (fz.current <= bounds.minZ) {
      fz.current = bounds.minZ;
      if (vz.current < 0) vz.current = 0;
    } else if (fz.current >= bounds.maxZ) {
      fz.current = bounds.maxZ;
      if (vz.current > 0) vz.current = 0;
    }

    const speed = Math.hypot(vx.current, vz.current);
    rt.current.speed = speed;
    rt.current.energy += (st.energy - rt.current.energy) * (1 - Math.exp(-dt / TAU_E));

    // --- 4) Cámara de persecución: encima y detrás del foco, mirando a +Z. ---
    const lean = THREE.MathUtils.clamp(vx.current / SPEED, -1, 1) * LEAN * BACK;
    let cy = HEIGHT;
    if (!st.reducedMotion && speed > 0.5) {
      cy += Math.sin(state.clock.elapsedTime * 1.6) * 0.08; // bob sutil de vuelo
    }
    camera.up.set(0, 1, 0);
    camera.position.set(fx.current + lean, cy, fz.current - BACK);
    lookV.current.set(fx.current, 0, fz.current + LOOK_AHEAD);
    camera.lookAt(lookV.current);

    // --- 4b) Empuje con la velocidad: el FOV se abre y la niebla se cierra. ---
    const sN = THREE.MathUtils.clamp(speed / SPEED, 0, 1);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      if (baseFov.current == null) baseFov.current = cam.fov;
      const targetFov = st.reducedMotion ? baseFov.current : baseFov.current + sN * FOV_KICK;
      if (Math.abs(cam.fov - targetFov) > 0.01) {
        cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt / FOV_TAU));
        cam.updateProjectionMatrix();
      }
    }
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog && fog.isFog) {
      if (baseFar.current == null) baseFar.current = fog.far;
      const targetFar = st.reducedMotion ? baseFar.current : baseFar.current - sN * FOG_TIGHTEN;
      fog.far += (targetFar - fog.far) * (1 - Math.exp(-dt / FOG_TAU));
    }

    // --- 5) Proximidad → ofrecer "Entrar" (el piloto decide; no atraca solo). ---
    focusV.current.set(fx.current, 0, fz.current);
    const near = nearestStation(graph, focusV.current);
    const can =
      !frozen && !!near && near.dist < ENTER_RADIUS && speed < ENTER_SPEED;
    const nid = can && near ? near.id : null;
    const pn = prevNear.current;
    if (pn.id !== nid || pn.can !== can) {
      st.setNearest(nid, can);
      pn.id = nid;
      pn.can = can;
    }

    // --- 6) Publicar el foco (con dead-band) para el minimapa. ---
    if (
      Math.abs(fx.current - lastFocus.current.x) +
        Math.abs(fz.current - lastFocus.current.z) >=
      FOCUS_DEADBAND
    ) {
      st.setFocus(fx.current, fz.current);
      lastFocus.current = { x: fx.current, z: fz.current };
    }
  });

  return null;
}
