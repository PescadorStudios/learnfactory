// ============================================================================
// BLOOM — resplandor cinematográfico (post-proceso) del mundo neuronal.
// ----------------------------------------------------------------------------
// Toma el render de la escena y le aplica UnrealBloomPass: los orbes, halos y
// filamentos (todos `toneMapped={false}`, por encima del umbral) FLORECEN — pasa
// de "líneas que brillan" a un espacio bioluminiscente de verdad.
//
// El mundo se "CARGA con tu racha": la fuerza del bloom sube con la energía
// (biofeedback), con la racha de aciertos y un punto con la velocidad → al ir
// bien y volar rápido, todo resplandece más. Agnóstico: lee desempeño, no contenido.
//
// Implementación sin dependencias nuevas: EffectComposer + pases vienen dentro de
// `three`. Al renderizar con prioridad > 0 en useFrame, R3F cede su render automático
// (este es el ÚNICO componente que lo hace); el rig/materiales corren en prioridad 0,
// así la cámara ya está actualizada al componer. Solo se monta en desktop (gate en Tunnel).
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { useJourney } from "../state/journeyStore";
import type { TunnelRuntime } from "./types";

const BASE_STRENGTH = 0.55; // resplandor en reposo
const EN_GAIN = 0.45; // suma por energía (biofeedback 0-1)
const STREAK_GAIN = 0.5; // suma por racha de aciertos
const SPEED_GAIN = 0.25; // suma por velocidad de vuelo
const RADIUS = 0.6;
const THRESHOLD = 0.55; // solo lo brillante florece (el fondo oscuro no)
const SPEED_NORM = 20; // = SPEED del rig: normaliza velocidad a 0-1
const TAU = 0.5; // suavizado de la fuerza (sin parpadeos bruscos)

export function Bloom({ rt }: { rt: MutableRefObject<TunnelRuntime> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const { composer, bloom } = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      BASE_STRENGTH,
      RADIUS,
      THRESHOLD
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return { composer, bloom };
    // El tamaño se ajusta en su propio efecto; no recrear el composer al redimensionar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  // Mantener el composer al tamaño del lienzo (y al pixel ratio actual).
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    bloom.setSize(size.width, size.height);
  }, [composer, bloom, gl, size]);

  useEffect(() => () => composer.dispose(), [composer]);

  const strength = useRef(BASE_STRENGTH);

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05);
    const st = useJourney.getState();
    const energy = THREE.MathUtils.clamp(rt.current.energy, 0, 1);
    const speedN = THREE.MathUtils.clamp(rt.current.speed / SPEED_NORM, 0, 1);
    const streakN = THREE.MathUtils.clamp((st.streak - 1) / 6, 0, 1); // racha 2..8 → 0..1

    const target = BASE_STRENGTH + energy * EN_GAIN + streakN * STREAK_GAIN + speedN * SPEED_GAIN;
    strength.current += (target - strength.current) * (1 - Math.exp(-dt / TAU));
    bloom.strength = strength.current;

    composer.render();
  }, 1); // prioridad 1 → toma el render (desactiva el auto-render de R3F)

  return null;
}
