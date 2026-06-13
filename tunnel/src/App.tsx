import { useJourney } from "./state/journeyStore";
import { Lobby } from "./screens/Lobby";
import { Tunnel } from "./screens/Tunnel";
import { RailDebug } from "./screens/RailDebug";

// Lobby → Túnel 3D (Fase 2). El mapa cenital (Capa 0) queda como vista debug,
// accesible con el botón "Mapa" dentro del túnel.
export default function App() {
  const phase = useJourney((s) => s.phase);
  const debugView = useJourney((s) => s.debugView);
  return (
    <div className="app">
      <div className="bg-glow" aria-hidden />
      {phase === "lobby" ? <Lobby /> : debugView ? <RailDebug /> : <Tunnel />}
    </div>
  );
}
