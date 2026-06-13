import { useJourney } from "./state/journeyStore";
import { Lobby } from "./screens/Lobby";
import { RailDebug } from "./screens/RailDebug";

// Fase 1: el flujo llega hasta la visualización (debug) del riel ensamblado.
// Fase 2 reemplazará <RailDebug /> por el mundo neuronal en react-three-fiber.
export default function App() {
  const phase = useJourney((s) => s.phase);
  return (
    <div className="app">
      <div className="bg-glow" aria-hidden />
      {phase === "lobby" ? <Lobby /> : <RailDebug />}
    </div>
  );
}
