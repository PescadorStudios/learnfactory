// ============================================================================
// PARTÍCULAS SINÁPTICAS — puntos bioluminiscentes que fluyen DENTRO del túnel.
// Cada partícula tiene un parámetro a lo largo de la curva y un offset radial
// (en el marco de Frenet de la curva), así "abrazan" el tubo. Avanzan con la
// velocidad de la cámara → reaccionan al scroll. Con reduced-motion: menos y
// más lentas. Un solo draw call (THREE.Points).
// ============================================================================

import { useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { softTexture } from "./softTexture";
import type { TunnelRuntime } from "./types";

export function SynapticParticles({
  curve,
  colorHex,
  rt,
  reduced,
  lowPower,
}: {
  curve: THREE.CatmullRomCurve3 | null;
  colorHex: string;
  rt: MutableRefObject<TunnelRuntime>;
  reduced: boolean;
  /** Móvil / pantalla táctil: menos partículas para sostener el framerate. */
  lowPower: boolean;
}) {
  const count = reduced ? 110 : lowPower ? 200 : 360;

  // Muestreo denso de la curva + marcos de Frenet (una vez por curva).
  const sampled = useMemo(() => {
    if (!curve) return null;
    const N = 600;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) points.push(curve.getPointAt(i / N));
    const frames = curve.computeFrenetFrames(N, false);
    return { N, points, normals: frames.normals, binormals: frames.binormals };
  }, [curve]);

  const data = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const params = new Float32Array(count);
    const radii = new Float32Array(count);
    const angles = new Float32Array(count);
    const c = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      params[i] = Math.random();
      radii[i] = 0.3 + Math.random() * 2.7;
      angles[i] = Math.random() * Math.PI * 2;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: reduced ? 0.5 : 0.72,
      map: softTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    return { geom, mat, params, radii, angles };
  }, [count, colorHex, reduced]);

  useEffect(
    () => () => {
      data.geom.dispose();
      data.mat.dispose();
    },
    [data]
  );

  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    if (!sampled) return;
    const { N, points, normals, binormals } = sampled;
    const { geom, mat, params, radii, angles } = data;
    // Biofeedback: con más energía, las partículas corren un poco más y brillan más.
    const e = rt.current.energy;
    mat.opacity = 0.5 + e * 0.5;
    const advance = (0.018 + rt.current.speed * 0.011) * dt * (0.7 + e * 0.7); // frac/seg
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < params.length; i++) {
      let p = params[i] + advance;
      if (p >= 1) p -= 1;
      params[i] = p;
      const idx = Math.min(N, Math.floor(p * N));
      const fIdx = Math.min(normals.length - 1, idx);
      const base = points[idx];
      const a = angles[i];
      const r = radii[i];
      tmp
        .copy(base)
        .addScaledVector(normals[fIdx], Math.cos(a) * r)
        .addScaledVector(binormals[fIdx], Math.sin(a) * r);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
  });

  if (!sampled) return null;
  return <points geometry={data.geom} material={data.mat} frustumCulled={false} />;
}
