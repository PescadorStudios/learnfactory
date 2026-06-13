// ============================================================================
// ESTACIONES — orbes bioluminiscentes (un núcleo facetado + halo aditivo).
// ----------------------------------------------------------------------------
// En vuelo libre los orbes son los destinos: hay que SABER QUÉ FALTA de un vistazo.
//   • Pendiente → color del nicho, halo que late.
//   • Completada → atenuada (gris frío), halo pequeño y quieto.
//   • Objetivo (la más cercana, lista para "Entrar") → halo grande y brillante.
// El color sale del nicho (agnóstico, vía hash). `completed` se lee del store;
// objetivo/cercanía se leen por frame (sin re-render).
// ============================================================================

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { softTexture } from "./softTexture";
import { colorForNiche } from "../theme";
import { useJourney } from "../state/journeyStore";
import type { RailNode } from "../types/rail";

const DONE_COLOR = new THREE.Color("#5a6b86"); // gris frío para completadas

export function StationLights({ nodes }: { nodes: RailNode[] }) {
  const stations = useMemo(() => nodes.filter((n) => n.kind === "station"), [nodes]);
  const tex = useMemo(() => softTexture(), []);
  const completed = useJourney((s) => s.completed);

  const items = useMemo(
    () =>
      stations.map((n) => ({
        id: n.id,
        color: new THREE.Color(n.niche ? colorForNiche(n.niche) : "#33e1ed"),
        pos: [n.position.x, n.position.y, n.position.z] as [number, number, number],
      })),
    [stations]
  );

  const cores = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const halos = useRef<(THREE.Sprite | null)[]>([]);
  const haloMats = useRef<(THREE.SpriteMaterial | null)[]>([]);
  const tmpColor = useRef(new THREE.Color());

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const st = useJourney.getState();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const done = !!completed[it.id];
      const target = st.nearestStationId === it.id && st.canEnter;

      const core = cores.current[i];
      if (core) {
        tmpColor.current.copy(done && !target ? DONE_COLOR : it.color);
        core.color.copy(tmpColor.current);
      }
      const halo = halos.current[i];
      const hm = haloMats.current[i];
      if (halo) {
        const scale = target
          ? 4.2 + Math.sin(t * 4) * 0.5 // objetivo: late fuerte
          : done
          ? 1.8 // completada: pequeño y quieto
          : 3.0 * (1 + Math.sin(t * 2 + i) * 0.18); // pendiente: late suave
        halo.scale.setScalar(scale);
      }
      if (hm) {
        hm.opacity = target ? 0.95 : done ? 0.35 : 0.8;
        tmpColor.current.copy(done && !target ? DONE_COLOR : it.color);
        hm.color.copy(tmpColor.current);
      }
    }
  });

  return (
    <group>
      {items.map((it, i) => (
        <group key={it.id} position={it.pos}>
          <mesh>
            <icosahedronGeometry args={[0.55, 1]} />
            <meshBasicMaterial
              ref={(el) => {
                cores.current[i] = el;
              }}
              color={it.color}
              toneMapped={false}
            />
          </mesh>
          <sprite
            ref={(el) => {
              halos.current[i] = el;
            }}
            scale={3.0}
          >
            <spriteMaterial
              ref={(el) => {
                haloMats.current[i] = el;
              }}
              map={tex}
              color={it.color}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </sprite>
        </group>
      ))}
    </group>
  );
}
