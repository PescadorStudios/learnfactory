// ============================================================================
// ESTELA DE VELOCIDAD — líneas de "salto" que rasgan el espacio al volar rápido.
// ----------------------------------------------------------------------------
// Da la sensación visceral del viaje: una nube de segmentos aditivos alrededor de
// la cámara que fluye hacia atrás y se ESTIRA con la velocidad. En reposo es
// invisible (opacidad 0) — coherente con "solo se mueve con input". Como la cámara
// siempre mira a +Z, las estelas se alinean con ese eje (look clásico de warp).
//
// Agnóstico (no es contenido): reacciona solo a `rt.speed`. Se desmonta con
// prefers-reduced-motion (gate en Tunnel) y baja el conteo en móvil (lowPower).
// ============================================================================

import { useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { TunnelRuntime } from "./types";

const SPEED_NORM = 16; // = SPEED del rig
const RADIUS = 7; // dispersión lateral (X)
const VSPREAD = 5; // dispersión vertical (Y)
const AHEAD = 60; // hasta dónde nacen por delante (dentro de la niebla)
const BEHIND = -16; // al pasar esto por detrás, reciclan adelante
const MAX_LEN = 6; // longitud máxima de la estela (a tope de velocidad)
const MAX_OPACITY = 0.5;

export function SpeedWarp({
  rt,
  lowPower = false,
}: {
  rt: MutableRefObject<TunnelRuntime>;
  lowPower?: boolean;
}) {
  const camera = useThree((s) => s.camera);

  const { lines, count, ox, oy, oz } = useMemo(() => {
    const count = lowPower ? 50 : 120;
    const positions = new Float32Array(count * 6);
    const geom = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("position", posAttr);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#86b5ff"),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geom, mat);
    lines.frustumCulled = false; // se mueven con la cámara; nunca culling

    const ox = new Float32Array(count);
    const oy = new Float32Array(count);
    const oz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      ox[i] = (Math.random() * 2 - 1) * RADIUS;
      oy[i] = (Math.random() * 2 - 1) * VSPREAD;
      oz[i] = BEHIND + Math.random() * (AHEAD - BEHIND);
    }
    return { lines, count, ox, oy, oz };
  }, [lowPower]);

  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
    [lines]
  );

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05);
    const v = rt.current.speed;
    const sN = THREE.MathUtils.clamp(v / SPEED_NORM, 0, 1);
    const mat = lines.material as THREE.LineBasicMaterial;
    mat.opacity = sN * MAX_OPACITY;
    if (sN <= 0.001) return; // en reposo: invisible y sin trabajo

    const half = (1.2 + sN * MAX_LEN) * 0.5;
    const flow = v * 1.5; // un poco más rápido que la cámara → parallax marcado
    const arr = (lines.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    for (let i = 0; i < count; i++) {
      oz[i] -= flow * dt;
      if (oz[i] < BEHIND) {
        oz[i] += AHEAD - BEHIND;
        ox[i] = (Math.random() * 2 - 1) * RADIUS;
        oy[i] = (Math.random() * 2 - 1) * VSPREAD;
      }
      const x = cx + ox[i];
      const y = cy + oy[i];
      const z = cz + oz[i];
      const o = i * 6;
      arr[o] = x;
      arr[o + 1] = y;
      arr[o + 2] = z - half;
      arr[o + 3] = x;
      arr[o + 4] = y;
      arr[o + 5] = z + half;
    }
    (lines.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  });

  return <primitive object={lines} />;
}
