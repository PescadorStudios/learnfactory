// ============================================================================
// ESTACIONES — nodos bioluminiscentes donde (en Fase 3) atracaremos al reto.
// Por ahora son marcadores: un núcleo facetado + un halo aditivo que late.
// El color sale del nicho de la estación (agnóstico, vía hash). Solo se dibujan
// las estaciones del path activo para no saturar la escena.
// ============================================================================

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { softTexture } from "./softTexture";
import { colorForNiche } from "../theme";
import type { RailNode } from "../types/rail";

export function StationLights({ nodes }: { nodes: RailNode[] }) {
  const stations = useMemo(() => nodes.filter((n) => n.kind === "station"), [nodes]);
  const tex = useMemo(() => softTexture(), []);
  const halos = useRef<(THREE.Sprite | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < halos.current.length; i++) {
      const s = halos.current[i];
      if (s) s.scale.setScalar(3.0 * (1 + Math.sin(t * 2 + i) * 0.18));
    }
  });

  return (
    <group>
      {stations.map((n, i) => {
        const color = n.niche ? colorForNiche(n.niche) : "#33e1ed";
        return (
          <group key={n.id} position={[n.position.x, n.position.y, n.position.z]}>
            <mesh>
              <icosahedronGeometry args={[0.55, 1]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <sprite
              ref={(el) => {
                halos.current[i] = el;
              }}
              scale={3.0}
            >
              <spriteMaterial
                map={tex}
                color={color}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </sprite>
          </group>
        );
      })}
    </group>
  );
}
