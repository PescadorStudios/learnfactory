// ============================================================================
// EL TÚNEL — mundo neuronal en VUELO LIBRE (Fase B).
// ----------------------------------------------------------------------------
// Monta el <Canvas> (Capa 1) que dibuja TODA la red (filamentos + orbes) y el HUD
// en DOM (Capa 3) por encima. La cámara la pilota el usuario con useFlyControls
// (arrastrar para volar / WASD-flechas) CON INERCIA: solo anda cuando la mueve.
// Nada temático vive aquí: color, títulos y retos salen del grafo (Capa 0).
//
// Navegación: avanzar / retroceder / cambiar de vena en los cruces (rumbo). Al
// acercarse a una estación y frenar aparece "Entrar" (el piloto decide; nada lo
// arrastra). Las estaciones son re-entrables. "Finalizar" abre el Recap.
// ============================================================================

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Canvas } from "@react-three/fiber";
import { useJourney } from "../state/journeyStore";
import { useFlyControls } from "../hooks/useFlyControls";
import { colorForNiche } from "../theme";
import { CameraRig } from "../world/CameraRig";
import { NeuralWeb } from "../world/NeuralWeb";
import { DustField } from "../world/DustField";
import { StationLights } from "../world/StationLights";
import { StationLabels } from "../world/StationLabels";
import { SpeedWarp } from "../world/SpeedWarp";
import { Bloom } from "../world/Bloom";
import { StationChallenge } from "./StationChallenge";
import { Narrator } from "./Narrator";
import { Minimap } from "./Minimap";
import { Recap } from "./Recap";
import { stopVoice } from "../audio/voice";
import type { TunnelRuntime } from "../world/types";

export function Tunnel() {
  const rail = useJourney((s) => s.rail);
  const reduced = useJourney((s) => s.reducedMotion);
  const atEnd = useJourney((s) => s.atEnd);
  const completed = useJourney((s) => s.completed);
  const activeStationId = useJourney((s) => s.activeStationId);
  const nearestStationId = useJourney((s) => s.nearestStationId);
  const canEnter = useJourney((s) => s.canEnter);
  const enterStation = useJourney((s) => s.enterStation);
  const finishJourney = useJourney((s) => s.finishJourney);
  const captured = useJourney((s) => s.captured);
  const streak = useJourney((s) => s.streak);
  const muted = useJourney((s) => s.muted);
  const toggleMuted = useJourney((s) => s.toggleMuted);
  const toggleDebug = useJourney((s) => s.toggleDebug);
  const backToLobby = useJourney((s) => s.backToLobby);
  const setReducedMotion = useJourney((s) => s.setReducedMotion);
  const narrate = useJourney((s) => s.narrate);

  // Móvil / táctil: baja DPR y densidad de motas. PERFORMANCE, no contenido.
  const [lowPower, setLowPower] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 640px)");
    setLowPower(mq.matches);
    const onChange = () => setLowPower(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Accesibilidad: prefers-reduced-motion (el rig suaviza/quita el giro y el balanceo).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setReducedMotion]);

  // Input de vuelo (arrastrar / teclado). Vive mientras el túnel está montado.
  const input = useFlyControls(true);

  const rt = useRef<TunnelRuntime>({ speed: 0, u: 0, distance: 0, energy: 0.5 });

  const activeNode = useMemo(
    () => (activeStationId ? rail?.nodes.find((n) => n.id === activeStationId) ?? null : null),
    [activeStationId, rail]
  );
  const nearestNode = useMemo(
    () => (nearestStationId ? rail?.nodes.find((n) => n.id === nearestStationId) ?? null : null),
    [nearestStationId, rail]
  );

  // Enter = entrar a la estación cercana (además del botón del prompt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const s = useJourney.getState();
      if (s.canEnter && s.nearestStationId && !s.activeStationId && !s.atEnd) {
        e.preventDefault();
        s.enterStation(s.nearestStationId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Al recorrer toda la red, el narrador lo celebra una vez (no fuerza el fin).
  const allDoneRef = useRef(false);
  useEffect(() => {
    if (!rail) return;
    const done = Object.keys(completed).length;
    if (done >= rail.meta.stationCount && rail.meta.stationCount > 0 && !allDoneRef.current) {
      allDoneRef.current = true;
      narrate("Recorriste toda la red. Finaliza el viaje cuando quieras.", "streak");
    }
  }, [completed, rail, narrate]);

  if (!rail) return null;

  const total = rail.meta.stationCount;
  const done = Math.min(Object.keys(completed).length, total);
  const barPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const enterColor = nearestNode?.niche ? colorForNiche(nearestNode.niche) : "#33e1ed";

  return (
    <div className="tunnel" style={rootStyle}>
      <Canvas
        style={{ position: "fixed", inset: 0 }}
        dpr={lowPower ? [1, 1.5] : [1, 2]}
        camera={{ fov: 72, near: 0.1, far: 600, position: [0, 0, -8] }}
        gl={{ antialias: !lowPower, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#05060c"]} />
        <fog attach="fog" args={["#05060c", 14, 150]} />
        <ambientLight intensity={0.3} />
        <CameraRig rail={rail} input={input} rt={rt} />
        <NeuralWeb rail={rail} />
        <StationLights nodes={rail.nodes} />
        <StationLabels nodes={rail.nodes} />
        <DustField rail={rail} reduced={reduced} lowPower={lowPower} />
        {/* Estela de "salto" al volar rápido (sin movimiento → invisible). */}
        {!reduced && <SpeedWarp rt={rt} lowPower={lowPower} />}
        {/* Bloom cinematográfico (toma el render). Solo desktop por rendimiento. */}
        {!lowPower && <Bloom rt={rt} />}
      </Canvas>

      {/* ---------------------------------------------------- HUD (Capa 3) --- */}
      <header className="hud hud__top">
        <button type="button" className="ghost" onClick={backToLobby}>
          ← Salir
        </button>
        <div className="hud__progress" aria-hidden title={`${done}/${total} lecciones`}>
          <span className="hud__bar" style={{ width: `${barPct}%` }} />
        </div>
        {streak >= 2 && (
          <span className="hud__streak" title="Racha de aciertos">
            ⚡ ×{streak}
          </span>
        )}
        <span className="hud__caps" title="Datos capturados">
          ✦ {captured.length}
        </span>
        <button
          type="button"
          className="ghost hud__mute"
          onClick={() => {
            if (!muted) stopVoice();
            toggleMuted();
          }}
          title={muted ? "Activar voz" : "Silenciar voz"}
          aria-label={muted ? "Activar voz" : "Silenciar voz"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button type="button" className="ghost" onClick={toggleDebug}>
          Mapa
        </button>
        <button
          type="button"
          className="ghost"
          onClick={finishJourney}
          title="Terminar el viaje y ver el resumen"
        >
          Finalizar
        </button>
      </header>

      {/* Narrador reactivo (se desvanece solo). */}
      <Narrator />

      {/* Estación atracada (pantalla completa). key = remonta por estación. */}
      {activeNode && <StationChallenge key={activeNode.id} node={activeNode} />}

      {/* Prompt de entrada por proximidad o, si no, la pista de controles. */}
      {!activeStationId &&
        !atEnd &&
        (canEnter && nearestNode ? (
          <div data-no-drag style={enterWrap}>
            <button
              type="button"
              onClick={() => enterStation(nearestNode.id)}
              style={{
                ...enterBtn,
                borderColor: enterColor,
                boxShadow: `0 0 30px -10px ${enterColor}`,
              }}
            >
              {nearestNode.niche && (
                <span style={{ ...enterNiche, color: enterColor }}>{nearestNode.niche}</span>
              )}
              <span style={enterTitle}>{nearestNode.title}</span>
              <span style={{ ...enterCta, color: enterColor }}>Entrar ⏎</span>
            </button>
          </div>
        ) : (
          <div style={hintWrap} aria-hidden>
            <span style={hintText}>
              Arrastra para volar — ↑ adentrarte · ↓ volver · ← → cambiar de tema · acércate a una
              neurona y frena para entrar
            </span>
          </div>
        ))}

      {/* Minimapa: orientación global mientras vuelas. */}
      {!activeStationId && !atEnd && <Minimap rail={rail} />}

      {atEnd && <Recap />}
    </div>
  );
}

// --- Estilos inline del HUD nuevo (no dependen del CSS del túnel). -----------
const rootStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  overflow: "hidden",
  touchAction: "none",
};
const enterWrap: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "8%",
  transform: "translateX(-50%)",
  zIndex: 40,
};
const enterBtn: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "14px 28px",
  borderRadius: 22,
  border: "2px solid",
  background: "rgba(8,10,18,0.82)",
  color: "#fff",
  cursor: "pointer",
  backdropFilter: "blur(6px)",
  minWidth: 200,
};
const enterNiche: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};
const enterTitle: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  lineHeight: 1.2,
  textAlign: "center",
};
const enterCta: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.08em",
  marginTop: 2,
};
const hintWrap: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "5%",
  transform: "translateX(-50%)",
  zIndex: 30,
  pointerEvents: "none",
  maxWidth: "92vw",
};
const hintText: CSSProperties = {
  fontSize: 12.5,
  color: "rgba(220,230,255,0.66)",
  background: "rgba(6,8,15,0.5)",
  padding: "7px 16px",
  borderRadius: 999,
  border: "1px solid rgba(120,150,220,0.18)",
  textAlign: "center",
  display: "inline-block",
};
