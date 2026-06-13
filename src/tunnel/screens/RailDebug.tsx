// ============================================================================
// RAIL DEBUG — visualización del grafo ensamblado en runtime (Fase 1).
// Mapa cenital (carriles × profundidad) del riel: venas, estaciones, cruces y
// bifurcaciones. Es la prueba visual de que la Capa 0 se ensambla bien.
// En Fase 2 esto se reemplaza por el mundo neuronal 3D, que leerá del MISMO Rail.
// ============================================================================

import { useJourney } from "../state/journeyStore";
import { NODE_END_COLOR, NODE_START_COLOR } from "../theme";
import type { ForkDirection, RailNode } from "../types/rail";

// Vista debug del grafo (Capa 0). Es la prueba de que el riel se ensambla bien;
// se abre con "Mapa" desde el túnel (toggleDebug) o queda visible si no hay 3D.

const PAD = 70;
const COL_W = 172;
const ROW_H = 108;
const R = 11;

export function RailDebug() {
  const rail = useJourney((s) => s.rail);
  const back = useJourney((s) => s.backToLobby);
  const toggleDebug = useJourney((s) => s.toggleDebug);
  if (!rail) return null;

  const laneCount = Math.max(1, rail.branches.length);
  const center = (laneCount - 1) / 2;

  const gx = (lane: number) => PAD + lane * COL_W;
  const gy = (layer: number) => PAD + (layer + 1) * ROW_H;
  const xy = (n: RailNode): [number, number] => {
    const lane = n.kind === "station" ? n.lane : center;
    return [gx(lane), gy(n.layer)];
  };

  const width = PAD * 2 + (laneCount - 1) * COL_W;
  const height = PAD * 2 + (rail.meta.depth + 1) * ROW_H;

  const byId = new Map(rail.nodes.map((n) => [n.id, n]));
  const branchColor = (branchId: string | null) =>
    rail.branches.find((b) => b.id === branchId)?.color ?? "#64748b";
  const nodeColor = (n: RailNode) =>
    n.kind === "start"
      ? NODE_START_COLOR
      : n.kind === "end"
        ? NODE_END_COLOR
        : branchColor(n.branchId);

  const forkIds = new Set(rail.forks.map((f) => f.atNodeId));

  return (
    <section className="debug">
      <header className="debug__head">
        <div>
          <p className="kicker">Capa 0 · El Riel</p>
          <h2 className="debug__title">Grafo ensamblado en runtime</h2>
        </div>
        <div className="debug__actions">
          <button type="button" className="ghost" onClick={toggleDebug}>
            ◐ Ver mundo 3D
          </button>
          <button type="button" className="ghost" onClick={back}>
            ← Volver al lobby
          </button>
        </div>
      </header>

      <div className="chips">
        <span className="chip">{rail.meta.branchCount} venas</span>
        <span className="chip">{rail.meta.stationCount} estaciones</span>
        <span className="chip">{rail.meta.forkCount} bifurcaciones</span>
        <span className="chip">{rail.meta.depth} capas</span>
        {rail.branches.map((b) => (
          <span key={b.id} className="chip chip--niche">
            <span className="dot" style={{ background: b.color }} />
            {b.niche}
          </span>
        ))}
      </div>

      <div className="debug__body">
        <div className="map">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            preserveAspectRatio="xMidYMin meet"
            role="img"
            aria-label="Mapa cenital del riel ensamblado"
          >
            {/* Aristas: spine (vena) sólidas, cross (cruce entre venas) punteadas. */}
            {rail.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const [x1, y1] = xy(a);
              const [x2, y2] = xy(b);
              return (
                <line
                  key={e.id}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={branchColor(e.branchId)}
                  strokeWidth={e.kind === "spine" ? 3 : 2}
                  strokeOpacity={e.kind === "spine" ? 0.75 : 0.35}
                  strokeDasharray={e.kind === "cross" ? "6 7" : undefined}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Nodos. */}
            {rail.nodes.map((n) => {
              const [x, y] = xy(n);
              const color = nodeColor(n);
              const isFork = forkIds.has(n.id);
              return (
                <g key={n.id}>
                  {isFork && (
                    <circle
                      cx={x}
                      cy={y}
                      r={R + 7}
                      fill="none"
                      stroke={color}
                      strokeOpacity={0.55}
                      strokeDasharray="3 4"
                    />
                  )}
                  <circle cx={x} cy={y} r={R} fill={color} />
                  {n.kind === "station" && (
                    <>
                      <text className="svg-tag" x={x} y={y - R - 9} textAnchor="middle">
                        {n.pod?.challenge.type === "impostor"
                          ? "IMPOSTOR"
                          : "TRAMPA"}
                      </text>
                      <text
                        className="svg-label"
                        x={x}
                        y={y + R + 17}
                        textAnchor="middle"
                      >
                        {truncate(n.title ?? "", 18)}
                      </text>
                    </>
                  )}
                  {n.kind === "start" && (
                    <text className="svg-glyph" x={x} y={y + 4} textAnchor="middle">
                      ▶
                    </text>
                  )}
                  {n.kind === "end" && (
                    <text
                      className="svg-label"
                      x={x}
                      y={y + R + 17}
                      textAnchor="middle"
                    >
                      Salida
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="forks">
          <h3>Bifurcaciones</h3>
          <p className="muted small">
            Donde se cruzan dos venas, el viajero elige con un swipe. La vena no
            elegida brilla y se aleja (eso lo hará la Capa 1).
          </p>
          {rail.forks.length === 0 ? (
            <p className="muted small">
              Sin bifurcaciones: seleccionaste un solo tema (viaje de una vena).
            </p>
          ) : (
            <ol className="fork-list">
              {rail.forks.map((f) => {
                const src = byId.get(f.atNodeId);
                const label =
                  src?.kind === "start"
                    ? "Entrada"
                    : truncate(src?.title ?? f.atNodeId, 22);
                return (
                  <li key={f.id}>
                    <span className="fork__src">{label}</span>
                    <span className="fork__opts">
                      {f.options.map((o) => (
                        <span key={o.edgeId} className={`opt opt--${o.direction}`}>
                          <span className="opt__arrow">{arrow(o.direction)}</span>
                          {o.title === "Salida"
                            ? "Salida"
                            : `${o.niche ?? ""} · ${truncate(o.title, 16)}`}
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
    </section>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function arrow(d: ForkDirection): string {
  return d === "left" ? "←" : d === "right" ? "→" : "↑";
}
