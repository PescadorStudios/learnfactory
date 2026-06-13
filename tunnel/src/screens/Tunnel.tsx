// ============================================================================
// EL TÚNEL — pantalla del mundo neuronal (Fases 2-3).
// ----------------------------------------------------------------------------
// Monta el <Canvas> (Capa 1) que lee el path activo derivado del grafo (Capa 0)
// y el HUD en DOM (Capa 3) por encima: barra de progreso, prompt de bifurcación
// (swipe / ← →), el reto de la estación atracada y la salida. Nada temático vive
// aquí: el color, los títulos y los retos salen del grafo. El scroll (lenis)
// alimenta el avance vía useScrollDrive.
//
// Fase 3: calcula la distancia de cada estación sobre la curva y el "gate" =
// próxima estación sin resolver (o fin/fork). El rig frena y atraca ahí; al
// resolver el reto, el gate avanza y la cámara reanuda.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { useJourney } from "../state/journeyStore";
import { useScrollDrive } from "../hooks/useScrollDrive";
import { buildCurve, resolvePath } from "../world/journeyPath";
import { colorForNiche } from "../theme";
import { CameraRig } from "../world/CameraRig";
import { TunnelTube } from "../world/TunnelTube";
import { SynapticParticles } from "../world/SynapticParticles";
import { StationLights } from "../world/StationLights";
import { ForkVeins } from "../world/ForkVeins";
import { StationChallenge } from "./StationChallenge";
import { Narrator } from "./Narrator";
import type { TunnelRuntime } from "../world/types";
import type { ForkDirection, RailFork } from "../types/rail";

export function Tunnel() {
  const rail = useJourney((s) => s.rail);
  const choices = useJourney((s) => s.choices);
  const reduced = useJourney((s) => s.reducedMotion);
  const showForkPrompt = useJourney((s) => s.showForkPrompt);
  const progressPct = useJourney((s) => s.progressPct);
  const atEnd = useJourney((s) => s.atEnd);
  const completed = useJourney((s) => s.completed);
  const activeStationId = useJourney((s) => s.activeStationId);
  const captured = useJourney((s) => s.captured);
  const streak = useJourney((s) => s.streak);
  const bestStreak = useJourney((s) => s.bestStreak);
  const toggleDebug = useJourney((s) => s.toggleDebug);
  const backToLobby = useJourney((s) => s.backToLobby);
  const setReducedMotion = useJourney((s) => s.setReducedMotion);

  // Accesibilidad: detecta prefers-reduced-motion y reacciona a cambios.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setReducedMotion]);

  // scroll → avance (inercia). lenis vive mientras el túnel está montado.
  useScrollDrive(true);

  const rt = useRef<TunnelRuntime>({ speed: 0, u: 0, distance: 0, energy: 0.5 });

  const path = useMemo(
    () => (rail ? resolvePath(rail, choices) : null),
    [rail, choices]
  );
  const curve = useMemo(() => (path ? buildCurve(path.nodes) : null), [path]);
  const length = useMemo(() => (curve ? curve.getLength() : 0), [curve]);

  // Distancia (longitud de arco) de cada nodo del path sobre la curva. El nodo i
  // de n cae en t=i/(n-1); con divisiones múltiplo de (n-1) leemos su arco exacto.
  const nodeDistances = useMemo(() => {
    if (!curve || !path || path.nodes.length < 2) return [] as number[];
    const n = path.nodes.length;
    const SUB = 40;
    const lengths = curve.getLengths(SUB * (n - 1)); // tamaño SUB*(n-1)+1
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(lengths[Math.min(lengths.length - 1, i * SUB)]);
    }
    return out;
  }, [curve, path]);

  // Compuerta = primera estación del path aún sin resolver (ahí se atraca). Si ya
  // no quedan, el gate es el final de la curva (fin del trayecto o nodo de fork).
  const { gateDistance, dockTargetId } = useMemo(() => {
    if (path && nodeDistances.length > 0) {
      for (let i = 0; i < path.nodes.length; i++) {
        const node = path.nodes[i];
        if (node.kind === "station" && !completed[node.id]) {
          return { gateDistance: nodeDistances[i] ?? length, dockTargetId: node.id };
        }
      }
    }
    return { gateDistance: length, dockTargetId: null as string | null };
  }, [path, nodeDistances, completed, length]);

  // Nodo atracado (si lo hay) para montar su reto en la Capa 3.
  const activeNode = useMemo(() => {
    if (!activeStationId) return null;
    return (
      path?.nodes.find((n) => n.id === activeStationId) ??
      rail?.nodes.find((n) => n.id === activeStationId) ??
      null
    );
  }, [activeStationId, path, rail]);

  const startPos = useMemo(() => {
    const s = rail?.nodes.find((n) => n.kind === "start");
    return new THREE.Vector3(
      s?.position.x ?? 0,
      s?.position.y ?? 0,
      s?.position.z ?? 0
    );
  }, [rail]);

  // Color de la vena activa = el nicho de la última estación recorrida.
  const activeColor = useMemo(() => {
    if (path) {
      for (let i = path.nodes.length - 1; i >= 0; i--) {
        const niche = path.nodes[i].niche;
        if (niche) return colorForNiche(niche);
      }
    }
    return "#33e1ed";
  }, [path]);

  // pendingFork accesible desde los handlers de input (sin re-suscribir).
  const pendingRef = useRef<RailFork | null>(null);
  pendingRef.current = path?.pendingFork ?? null;

  const downX = useRef<number | null>(null);

  // Teclas ← ↑ → (la ↑/Enter elige la opción central).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useJourney.getState().showForkPrompt) return;
      const f = pendingRef.current;
      if (!f) return;
      if (e.key === "ArrowLeft") commit(f, "left");
      else if (e.key === "ArrowRight") commit(f, "right");
      else if (e.key === "ArrowUp" || e.key === "Enter") commit(f, "straight");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!rail || !path) return null;
  const pendingFork = path.pendingFork;

  return (
    <div
      className="tunnel"
      onPointerDown={(e) => {
        downX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        const x0 = downX.current;
        downX.current = null;
        if (x0 == null) return;
        const f = pendingRef.current;
        if (!f || !useJourney.getState().showForkPrompt) return;
        const dx = e.clientX - x0;
        if (dx <= -45) commit(f, "left");
        else if (dx >= 45) commit(f, "right");
      }}
    >
      {/* Sala de scroll para lenis (el canvas es fixed por encima). */}
      <div className="tunnel__scroll" aria-hidden />

      <Canvas
        style={{ position: "fixed", inset: 0 }}
        dpr={[1, 2]}
        camera={{ fov: 74, near: 0.1, far: 300, position: [0, 0, -8] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#06070d"]} />
        <fog attach="fog" args={["#06070d", 16, 95]} />
        <ambientLight intensity={0.25} />
        <CameraRig
          curve={curve}
          length={length}
          pendingFork={pendingFork}
          gateDistance={gateDistance}
          dockTargetId={dockTargetId}
          startPos={startPos}
          rt={rt}
        />
        <TunnelTube curve={curve} colorHex={activeColor} rt={rt} />
        <SynapticParticles
          curve={curve}
          colorHex={activeColor}
          rt={rt}
          reduced={reduced}
        />
        <StationLights nodes={path.nodes} />
        <ForkVeins rail={rail} choices={choices} pendingFork={pendingFork} />
      </Canvas>

      {/* ---------------------------------------------------- HUD (Capa 3) --- */}
      <header className="hud hud__top">
        <button type="button" className="ghost" onClick={backToLobby}>
          ← Salir
        </button>
        <div className="hud__progress" aria-hidden>
          <span className="hud__bar" style={{ width: `${progressPct}%` }} />
        </div>
        {streak >= 2 && (
          <span className="hud__streak" title="Racha de aciertos">
            ⚡ ×{streak}
          </span>
        )}
        <span className="hud__caps" title="Datos capturados">
          ✦ {captured.length}
        </span>
        <button type="button" className="ghost" onClick={toggleDebug}>
          Mapa
        </button>
      </header>

      {/* Narrador reactivo (Capa 3): se desvanece solo. */}
      <Narrator />

      {/* Reto de la estación atracada (Capa 3). key = remonta por estación. */}
      {activeNode && <StationChallenge key={activeNode.id} node={activeNode} />}

      {showForkPrompt && pendingFork && (
        <div className="fork-prompt">
          <p className="fork-prompt__hint">Elige tu camino · desliza o usa ← →</p>
          <div className="fork-prompt__opts">
            {pendingFork.options.map((o) => {
              const color = o.niche ? colorForNiche(o.niche) : "#94a3b8";
              return (
                <button
                  key={o.edgeId}
                  type="button"
                  className="fork-card"
                  style={{
                    borderColor: color,
                    boxShadow: `0 0 26px -8px ${color}`,
                  }}
                  onClick={() =>
                    useJourney.getState().commitFork(pendingFork.atNodeId, o.edgeId)
                  }
                >
                  <span className="fork-card__arrow" style={{ color }}>
                    {arrow(o.direction)}
                  </span>
                  {o.niche && (
                    <span className="fork-card__niche" style={{ color }}>
                      {o.niche}
                    </span>
                  )}
                  <span className="fork-card__title">{o.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {atEnd && (
        <div className="end-card">
          <p className="kicker">Fin del trayecto</p>
          <h2>Saliste del túnel</h2>
          <p className="muted small">
            Capturaste <strong>{captured.length}</strong>{" "}
            {captured.length === 1 ? "dato" : "datos"} sin sentir que estudiabas.
          </p>
          {captured.length > 0 && (
            <div className="end-card__stats">
              <span>
                <strong>{captured.filter((c) => c.success).length}</strong>/
                {captured.length} aciertos
              </span>
              {bestStreak >= 2 && (
                <span className="end-card__streak">mejor racha ⚡×{bestStreak}</span>
              )}
            </div>
          )}
          {captured.length > 0 && (
            <ul className="end-card__caps">
              {captured.slice(-4).map((c) => (
                <li key={c.id}>
                  <span aria-hidden>{c.success ? "✓" : "·"}</span> {c.reward}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">El recap compartible llega en la fase final.</p>
          <div className="end-card__btns">
            <button type="button" className="cta" onClick={backToLobby}>
              Volver al lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function commit(f: RailFork, dir: ForkDirection) {
  const opt = optionForDir(f, dir);
  if (opt) useJourney.getState().commitFork(f.atNodeId, opt.edgeId);
}

function optionForDir(f: RailFork, dir: ForkDirection) {
  const o = f.options;
  if (o.length === 0) return undefined;
  if (dir === "left") return o[0];
  if (dir === "right") return o[o.length - 1];
  return o[Math.floor(o.length / 2)];
}

function arrow(d: ForkDirection): string {
  return d === "left" ? "←" : d === "right" ? "→" : "↑";
}
