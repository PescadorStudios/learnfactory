// ============================================================================
// VENAS DE BIFURCACIÓN — el FOMO visual.
// • Fork pendiente: TODAS las opciones se dibujan adelante como venas que laten,
//   invitando a elegir (swipe izq/der).
// • Forks ya resueltos: la(s) opción(es) NO elegida(s) quedan como venas tenues
//   que se alejan — el "camino que no tomaste", brillando débil a tu espalda.
// Lee solo del grafo (Capa 0); agnóstico al contenido.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { colorForNiche } from "../theme";
import type { Rail, RailFork, RailNode } from "../types/rail";

interface Vein {
  geom: THREE.TubeGeometry;
  color: THREE.Color;
  pending: boolean;
}

export function ForkVeins({
  rail,
  choices,
  pendingFork,
}: {
  rail: Rail;
  choices: Record<string, string>;
  pendingFork: RailFork | null;
}) {
  const veins = useMemo<Vein[]>(() => {
    const byId = new Map(rail.nodes.map((n) => [n.id, n]));
    const out: Vein[] = [];

    const make = (
      from: RailNode,
      toId: string,
      niche: string | null,
      pending: boolean
    ) => {
      const to = byId.get(toId);
      if (!to) return;
      const a = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
      const b = new THREE.Vector3(to.position.x, to.position.y, to.position.z);
      // Extiende un poco más allá del nodo destino para que "se pierda" en la niebla.
      const beyond = b.clone().add(b.clone().sub(a).multiplyScalar(0.4));
      const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(b, 0.5), b, beyond]);
      const geom = new THREE.TubeGeometry(curve, 22, pending ? 0.7 : 0.4, 10, false);
      out.push({
        geom,
        color: new THREE.Color(niche ? colorForNiche(niche) : "#94a3b8"),
        pending,
      });
    };

    if (pendingFork) {
      const src = byId.get(pendingFork.atNodeId);
      if (src) for (const o of pendingFork.options) make(src, o.toNodeId, o.niche, true);
    }

    for (const f of rail.forks) {
      const chosen = choices[f.atNodeId];
      if (!chosen) continue;
      const src = byId.get(f.atNodeId);
      if (!src) continue;
      for (const o of f.options) {
        if (o.edgeId === chosen) continue;
        make(src, o.toNodeId, o.niche, false);
      }
    }
    return out;
  }, [rail, choices, pendingFork]);

  useEffect(() => () => veins.forEach((v) => v.geom.dispose()), [veins]);

  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < mats.current.length; i++) {
      const m = mats.current[i];
      const v = veins[i];
      if (m && v) m.opacity = v.pending ? 0.55 + Math.sin(t * 3 + i) * 0.35 : 0.16;
    }
  });

  return (
    <group>
      {veins.map((v, i) => (
        <mesh key={i} geometry={v.geom}>
          <meshBasicMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            color={v.color}
            transparent
            opacity={v.pending ? 0.7 : 0.16}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
