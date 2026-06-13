// ============================================================================
// RED NEURONAL — todas las aristas del grafo como filamentos bioluminiscentes.
// ----------------------------------------------------------------------------
// En el vuelo libre el piloto navega TODA la red, no un solo camino: por eso
// dibujamos cada arista (spine + cruces) como un axón que conecta los orbes de
// estación (StationLights). El color sale del nicho del nodo destino (agnóstico,
// vía hash). Aditivo + leve latido para que la web "respire". Lee solo Capa 0.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { colorForNiche } from "../theme";
import type { Rail } from "../types/rail";

interface Filament {
  geom: THREE.TubeGeometry;
  color: THREE.Color;
  base: number; // opacidad base (spine más visible que cross)
}

export function NeuralWeb({ rail }: { rail: Rail }) {
  const filaments = useMemo<Filament[]>(() => {
    const byId = new Map(rail.nodes.map((n) => [n.id, n]));
    const out: Filament[] = [];
    for (const e of rail.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const va = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
      const vb = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
      const curve = new THREE.CatmullRomCurve3([va, va.clone().lerp(vb, 0.5), vb]);
      const geom = new THREE.TubeGeometry(curve, 16, 0.16, 8, false);
      const niche = b.niche ?? a.niche ?? null;
      out.push({
        geom,
        color: new THREE.Color(niche ? colorForNiche(niche) : "#5b73c7"),
        base: e.kind === "spine" ? 0.34 : 0.2,
      });
    }
    return out;
  }, [rail]);

  useEffect(() => () => filaments.forEach((f) => f.geom.dispose()), [filaments]);

  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < mats.current.length; i++) {
      const m = mats.current[i];
      const f = filaments[i];
      if (m && f) m.opacity = f.base + Math.sin(t * 1.3 + i * 0.6) * 0.07;
    }
  });

  return (
    <group>
      {filaments.map((f, i) => (
        <mesh key={i} geometry={f.geom} frustumCulled={false}>
          <meshBasicMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            color={f.color}
            transparent
            opacity={f.base}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
