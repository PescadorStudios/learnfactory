// ============================================================================
// POLVO SINÁPTICO — motas bioluminiscentes que llenan el VOLUMEN de la red.
// ----------------------------------------------------------------------------
// En vuelo libre la cámara surca espacio abierto: estas motas estáticas dan
// parallax y sensación de velocidad al pasar entre ellas. Llenan la caja que
// envuelve al grafo (con margen) y titilan suave. Un solo draw call (Points).
// Menos densidad en reduced-motion / lowPower. Agnóstico: solo geometría.
// ============================================================================

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { softTexture } from "./softTexture";
import type { Rail } from "../types/rail";

const HUES = ["#33e1ed", "#5b8cff", "#b06bff"];

export function DustField({
  rail,
  reduced,
  lowPower,
}: {
  rail: Rail;
  reduced: boolean;
  lowPower: boolean;
}) {
  const count = reduced ? 240 : lowPower ? 520 : 1100;

  const { geom, mat } = useMemo(() => {
    // Caja envolvente del grafo, con margen para que las motas rodeen el vuelo.
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const n of rail.nodes) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y);
      minZ = Math.min(minZ, n.position.z);
      maxZ = Math.max(maxZ, n.position.z);
    }
    if (!isFinite(minX)) {
      minX = -5;
      maxX = 5;
      minY = -5;
      maxY = 5;
      minZ = -5;
      maxZ = 5;
    }
    const padXY = 12;
    const padZ = 10;
    const x0 = minX - padXY,
      xs = maxX - minX + padXY * 2;
    const y0 = minY - padXY,
      ys = maxY - minY + padXY * 2;
    const z0 = minZ - padZ,
      zs = maxZ - minZ + padZ * 2;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x0 + Math.random() * xs;
      positions[i * 3 + 1] = y0 + Math.random() * ys;
      positions[i * 3 + 2] = z0 + Math.random() * zs;
      tmp.set(HUES[(Math.random() * HUES.length) | 0]);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: reduced ? 0.34 : 0.46,
      map: softTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    return { geom, mat };
  }, [rail, count, reduced]);

  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
    },
    [geom, mat]
  );

  useFrame((state) => {
    // Titileo global muy leve (sin mover las motas: el parallax lo da la cámara).
    mat.opacity = 0.5 + Math.sin(state.clock.elapsedTime * 0.8) * 0.12;
  });

  return <points geometry={geom} material={mat} frustumCulled={false} />;
}
