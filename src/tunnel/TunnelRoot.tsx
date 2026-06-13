"use client";

// ============================================================================
// RAÍZ DEL TÚNEL (entrada nativa en Next) — equivale al antiguo App.tsx de Vite.
// ----------------------------------------------------------------------------
// Se monta SOLO en /tunel y SOLO en cliente (la ruta lo carga con ssr:false),
// porque el mundo es WebGL/canvas + APIs del navegador. Todo cuelga de
// .lf-tunnel-root: el contrato de estilos del túnel vive bajo esa raíz y por eso
// JAMÁS toca el resto de la app (la app sigue exactamente igual).
//
// El mundo 3D (three.js, el grueso del peso) va en DIFERIDO con lazy + Suspense:
// el lobby pinta al instante y el túnel/mapa llegan en su propio chunk async.
// ============================================================================

import { lazy, Suspense } from "react";
import { useJourney } from "./state/journeyStore";
import { Lobby } from "./screens/Lobby";
import "./tunnel.css";

const Tunnel = lazy(() =>
  import("./screens/Tunnel").then((m) => ({ default: m.Tunnel }))
);
const RailDebug = lazy(() =>
  import("./screens/RailDebug").then((m) => ({ default: m.RailDebug }))
);

export default function TunnelRoot() {
  const phase = useJourney((s) => s.phase);
  const debugView = useJourney((s) => s.debugView);
  return (
    <div className="lf-tunnel-root">
      <div className="bg-glow" aria-hidden />
      {phase === "lobby" ? (
        <Lobby />
      ) : (
        <Suspense fallback={<TunnelLoading />}>
          {debugView ? <RailDebug /> : <Tunnel />}
        </Suspense>
      )}
    </div>
  );
}

// Fallback mientras carga el chunk del mundo 3D.
function TunnelLoading() {
  return (
    <div className="tunnel-loading">
      <span className="tunnel-loading__pulse" aria-hidden />
      <p>Entrando al túnel…</p>
    </div>
  );
}
