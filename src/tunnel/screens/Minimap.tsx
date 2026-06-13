// ============================================================================
// MINIMAPA — orientación global del vuelo (Capa 3, DOM sobre el canvas).
// ----------------------------------------------------------------------------
// Vista cenital del plano de la red: el piloto ve DÓNDE está, hacia dónde mira y
// QUÉ LE FALTA. Mapea el mundo (x, z) a una cajita: X = tema (horizontal), Z =
// profundidad (vertical; arriba = entrada, abajo = lo que falta). Estaciones:
//   • pendiente → punto del color del nicho;  • completada → anillo tenue;
//   • objetivo (lista para entrar) → anillo brillante.
// La cámara es un cursor que apunta hacia +Z (su rumbo fijo). Agnóstico: todo sale
// del grafo. Lee camFocus/completed/nearest del store (se re-renderiza él solo).
// ============================================================================

import { useMemo, type CSSProperties } from "react";
import { useJourney } from "../state/journeyStore";
import { colorForNiche } from "../theme";
import type { Rail } from "../types/rail";

const W = 168;
const H = 132;
const PAD = 16;

export function Minimap({ rail }: { rail: Rail }) {
  const camFocus = useJourney((s) => s.camFocus);
  const completed = useJourney((s) => s.completed);
  const nearestStationId = useJourney((s) => s.nearestStationId);
  const canEnter = useJourney((s) => s.canEnter);

  const layout = useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const n of rail.nodes) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x);
      minZ = Math.min(minZ, n.position.z);
      maxZ = Math.max(maxZ, n.position.z);
    }
    if (!isFinite(minX)) {
      minX = -5;
      maxX = 5;
      minZ = -5;
      maxZ = 5;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const toPx = (x: number, z: number) => ({
      px: PAD + ((x - minX) / spanX) * (W - 2 * PAD),
      py: PAD + ((z - minZ) / spanZ) * (H - 2 * PAD),
    });
    const stations = rail.nodes
      .filter((n) => n.kind === "station")
      .map((n) => ({
        id: n.id,
        color: n.niche ? colorForNiche(n.niche) : "#33e1ed",
        ...toPx(n.position.x, n.position.z),
      }));
    const ends = rail.nodes
      .filter((n) => n.kind !== "station")
      .map((n) => ({ id: n.id, ...toPx(n.position.x, n.position.z) }));
    return { toPx, stations, ends };
  }, [rail]);

  const total = layout.stations.length;
  const done = layout.stations.filter((s) => completed[s.id]).length;
  const me = layout.toPx(camFocus.x, camFocus.z);

  return (
    <div data-no-drag style={wrap}>
      <div style={caption}>
        <span style={{ color: "#fff", fontWeight: 700 }}>{done}</span>
        <span style={{ opacity: 0.6 }}>/{total} lecciones</span>
        {done < total && <span style={{ opacity: 0.6 }}> · faltan {total - done}</span>}
      </div>
      <svg width={W} height={H} style={{ display: "block" }}>
        <rect
          x={0.5}
          y={0.5}
          width={W - 1}
          height={H - 1}
          rx={12}
          fill="rgba(6,9,18,0.62)"
          stroke="rgba(120,150,220,0.22)"
        />
        {/* entrada / salida */}
        {layout.ends.map((e) => (
          <circle key={e.id} cx={e.px} cy={e.py} r={2.4} fill="rgba(160,180,220,0.5)" />
        ))}
        {/* estaciones */}
        {layout.stations.map((s) => {
          const isDone = !!completed[s.id];
          const isTarget = nearestStationId === s.id && canEnter;
          if (isTarget) {
            return (
              <g key={s.id}>
                <circle cx={s.px} cy={s.py} r={6} fill="none" stroke={s.color} strokeWidth={2} />
                <circle cx={s.px} cy={s.py} r={2.6} fill={s.color} />
              </g>
            );
          }
          if (isDone) {
            return (
              <circle
                key={s.id}
                cx={s.px}
                cy={s.py}
                r={3.4}
                fill="none"
                stroke="rgba(150,165,190,0.55)"
                strokeWidth={1.4}
              />
            );
          }
          return <circle key={s.id} cx={s.px} cy={s.py} r={3.6} fill={s.color} />;
        })}
        {/* la cámara: cursor que mira hacia +Z (abajo en el mapa) */}
        <g transform={`translate(${me.px} ${me.py})`}>
          <polygon points="0,7 -4.5,-4 4.5,-4" fill="#ffffff" opacity={0.95} />
          <circle cx={0} cy={0} r={2} fill="#ffffff" />
        </g>
      </svg>
    </div>
  );
}

const wrap: CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 35,
  borderRadius: 14,
  padding: 8,
  background: "rgba(4,6,12,0.42)",
  backdropFilter: "blur(4px)",
  userSelect: "none",
};
const caption: CSSProperties = {
  fontSize: 11.5,
  letterSpacing: "0.02em",
  color: "rgba(220,230,255,0.8)",
  padding: "0 4px 5px",
  display: "flex",
  gap: 4,
  alignItems: "baseline",
};
