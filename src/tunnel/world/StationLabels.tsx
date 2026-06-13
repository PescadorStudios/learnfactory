// ============================================================================
// ETIQUETAS DE ESTACIÓN — el título de cada lección flotando sobre su orbe.
// ----------------------------------------------------------------------------
// Para saber QUÉ es cada destino sin entrar. Cada etiqueta es un sprite con una
// textura de canvas (texto + glow del nicho), siempre de cara a la cámara. Se
// desvanecen con la distancia (solo se leen las cercanas → sin saturar) y también
// al estar MUY cerca (para no tapar el orbe al entrar). Agnóstico: el texto sale
// del grafo (Capa 0). Un sprite por estación; se libera al desmontar.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { colorForNiche } from "../theme";
import type { RailNode } from "../types/rail";

function labelTexture(text: string, accent: string): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.font = "700 46px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  // Glow del nicho detrás del texto, luego el texto en blanco nítido.
  ctx.shadowColor = accent;
  ctx.shadowBlur = 22;
  ctx.fillStyle = accent;
  ctx.fillText(label, w / 2, h / 2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function StationLabels({ nodes }: { nodes: RailNode[] }) {
  const items = useMemo(() => {
    return nodes
      .filter((n) => n.kind === "station")
      .map((n) => {
        const accent = n.niche ? colorForNiche(n.niche) : "#9fb4ff";
        return {
          id: n.id,
          tex: labelTexture(n.title ?? "Estación", accent),
          pos: new THREE.Vector3(n.position.x, 1.7, n.position.z),
        };
      });
  }, [nodes]);

  useEffect(() => () => items.forEach((it) => it.tex.dispose()), [items]);

  const mats = useRef<(THREE.SpriteMaterial | null)[]>([]);

  useFrame(({ camera }) => {
    for (let i = 0; i < items.length; i++) {
      const m = mats.current[i];
      if (!m) continue;
      const d = camera.position.distanceTo(items[i].pos);
      let o = d < 32 ? THREE.MathUtils.clamp((32 - d) / 14, 0, 1) : 0;
      if (d < 4.5) o *= THREE.MathUtils.clamp((d - 1.5) / 3, 0, 1); // muy cerca: cede
      m.opacity = o * 0.95;
    }
  });

  return (
    <group>
      {items.map((it, i) => (
        <sprite key={it.id} position={it.pos} scale={[5.2, 1.3, 1]}>
          <spriteMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            map={it.tex}
            transparent
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
            opacity={0}
          />
        </sprite>
      ))}
    </group>
  );
}
