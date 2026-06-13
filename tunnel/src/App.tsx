import { lazy, Suspense } from "react";
import { useJourney } from "./state/journeyStore";
import { Lobby } from "./screens/Lobby";

// El mundo 3D (three.js + r3f) es el grueso del bundle. Se carga en DIFERIDO para
// que el lobby pinte al instante; el túnel y el mapa debug llegan en su propio
// chunk async (mejor primer pintado, sobre todo en móvil). El lobby va eager:
// es lo primero que se ve.
const Tunnel = lazy(() =>
  import("./screens/Tunnel").then((m) => ({ default: m.Tunnel }))
);
const RailDebug = lazy(() =>
  import("./screens/RailDebug").then((m) => ({ default: m.RailDebug }))
);

export default function App() {
  const phase = useJourney((s) => s.phase);
  const debugView = useJourney((s) => s.debugView);
  return (
    <div className="app">
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
