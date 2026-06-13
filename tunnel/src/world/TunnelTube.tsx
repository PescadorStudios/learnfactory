// ============================================================================
// EL TÚNEL — geometría tubular sobre la curva activa + piel neuronal (shader).
// Se ve desde dentro (BackSide). El color lo inyecta la vena activa y se
// interpola suave al cambiar de vena en un fork. El tiempo/velocidad alimentan
// los pulsos del shader: el túnel "fluye" más rápido cuando aceleras el scroll.
// ============================================================================

import { useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { NEURON_FRAG, NEURON_VERT, neuronUniforms } from "./neuronShader";
import type { TunnelRuntime } from "./types";

const RADIUS = 3.4;
const RADIAL_SEG = 26;

export function TunnelTube({
  curve,
  colorHex,
  rt,
}: {
  curve: THREE.CatmullRomCurve3 | null;
  colorHex: string;
  rt: MutableRefObject<TunnelRuntime>;
}) {
  const target = useMemo(() => new THREE.Color(colorHex), [colorHex]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: NEURON_VERT,
        fragmentShader: NEURON_FRAG,
        uniforms: neuronUniforms(new THREE.Color(colorHex)),
        side: THREE.BackSide,
      }),
    // El color inicial no importa: se interpola a `target` cada frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const geometry = useMemo(() => {
    if (!curve) return null;
    const len = curve.getLength();
    const seg = Math.min(700, Math.max(80, Math.floor(len * 6)));
    return new THREE.TubeGeometry(curve, seg, RADIUS, RADIAL_SEG, false);
  }, [curve]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, dt) => {
    const u = material.uniforms;
    u.uTime.value += dt;
    u.uSpeed.value = rt.current.speed;
    // Biofeedback: el brillo general sigue la energía (desempeño). ~0.75 apagado,
    // ~1.35 en reposo, ~2.1 a tope. El suavizado ya viene de rt.energy (el rig).
    u.uIntensity.value = 0.6 + rt.current.energy * 1.5;
    (u.uColor.value as THREE.Color).lerp(target, 1 - Math.exp(-dt * 2.5));
  });

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
