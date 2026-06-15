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

const LABEL_W = 512; // ancho del canvas (px)
const LABEL_H = 256; // alto: deja sitio a hasta 3 líneas sin recortar títulos largos
const LABEL_FONT = "700 40px system-ui, -apple-system, Segoe UI, sans-serif";
const LABEL_MAX_LINES = 3; // líneas antes de poner "…"
const LABEL_LINE_H = 50; // interlineado (px)

/** Envuelve `text` en líneas que quepan en `maxW`, cortando por palabra. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxW || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === LABEL_MAX_LINES) break; // ya no caben más líneas
    }
  }
  if (line && lines.length < LABEL_MAX_LINES) lines.push(line);
  // Si sobró texto (se cortó por límite de líneas), marca la última con "…".
  if (lines.length === LABEL_MAX_LINES) {
    const joined = lines.join(" ");
    if (joined.replace(/\s+/g, " ").trim() !== text.replace(/\s+/g, " ").trim()) {
      lines[LABEL_MAX_LINES - 1] = `${lines[LABEL_MAX_LINES - 1].replace(/[\s.,;:]+$/, "")}…`;
    }
  }
  return lines.length ? lines : [text];
}

function labelTexture(text: string, accent: string): THREE.CanvasTexture {
  const w = LABEL_W;
  const h = LABEL_H;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapLines(ctx, text, w - 32);
  const total = lines.length;
  const y0 = h / 2 - ((total - 1) * LABEL_LINE_H) / 2;

  lines.forEach((line, i) => {
    const y = y0 + i * LABEL_LINE_H;
    // Glow del nicho detrás del texto, luego el texto en blanco nítido.
    ctx.shadowColor = accent;
    ctx.shadowBlur = 22;
    ctx.fillStyle = accent;
    ctx.fillText(line, w / 2, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, w / 2, y);
  });

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
          pos: new THREE.Vector3(n.position.x, 2.4, n.position.z),
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
      // Visible desde más lejos (acorde al mayor espaciado): lee el próximo destino.
      let o = d < 46 ? THREE.MathUtils.clamp((46 - d) / 18, 0, 1) : 0;
      if (d < 4.5) o *= THREE.MathUtils.clamp((d - 1.5) / 3, 0, 1); // muy cerca: cede
      m.opacity = o * 0.95;
    }
  });

  return (
    <group>
      {items.map((it, i) => (
        <sprite key={it.id} position={it.pos} scale={[6, 3, 1]}>
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
