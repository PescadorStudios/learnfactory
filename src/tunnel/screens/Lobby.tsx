// ============================================================================
// LOBBY — pantalla de selección (Flujo del usuario, paso 1).
// Lista las lecciones del provider; el usuario marca las que quiere integrar y
// pulsa "Iniciar viaje". El túnel se ensambla en vivo con esa selección.
// ============================================================================

import { useEffect } from "react";
import { useJourney } from "../state/journeyStore";
import { colorForNiche } from "../theme";

export function Lobby() {
  const catalog = useJourney((s) => s.catalog);
  const catalogStatus = useJourney((s) => s.catalogStatus);
  const selectedIds = useJourney((s) => s.selectedIds);
  const assembling = useJourney((s) => s.assembling);
  const error = useJourney((s) => s.error);
  const loadCatalog = useJourney((s) => s.loadCatalog);
  const toggleSelect = useJourney((s) => s.toggleSelect);
  const startJourney = useJourney((s) => s.startJourney);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const estPods = catalog
    .filter((l) => selectedIds.includes(l.id))
    .reduce((n, l) => n + l.estPods, 0);

  return (
    <section className="lobby">
      {/* Salida del add-on: vuelve a la app de siempre. Navegación dura (<a>) a
          propósito — desmonta limpiamente el contexto WebGL/three.js del túnel. */}
      <a href="/" className="lobby__back" aria-label="Volver a Learn Factory">
        ← Volver a Learn Factory
      </a>
      <header className="lobby__head">
        <p className="kicker">Learn Factory</p>
        <h1 className="lobby__title">El Túnel</h1>
        <p className="lobby__sub">
          Elige los temas que quieres integrar a tu viaje. El túnel se ensambla
          en vivo a partir de tu selección.
        </p>
      </header>

      {catalogStatus === "loading" && <p className="muted">Cargando lecciones…</p>}
      {catalogStatus === "error" && (
        <p className="error">No se pudo cargar el contenido. {error}</p>
      )}

      <ul className="cards">
        {catalog.map((l) => {
          const on = selectedIds.includes(l.id);
          const color = colorForNiche(l.niche);
          return (
            <li key={l.id}>
              <button
                type="button"
                className={`card ${on ? "card--on" : ""}`}
                aria-pressed={on}
                onClick={() => toggleSelect(l.id)}
                style={
                  on
                    ? {
                        borderColor: color,
                        boxShadow: `0 0 0 1px ${color}, 0 0 32px -8px ${color}`,
                      }
                    : undefined
                }
              >
                <span className="card__niche" style={{ color }}>
                  {l.niche}
                </span>
                <span className="card__title">{l.title}</span>
                <span className="card__blurb">{l.blurb}</span>
                <span className="card__foot">
                  <span className="card__pods">{l.estPods} estaciones</span>
                  <span
                    className="card__check"
                    aria-hidden
                    style={on ? { background: color, color: "#06070d" } : undefined}
                  >
                    {on ? "✓" : "+"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="lobby__foot">
        <span className="muted">
          {selectedIds.length} {selectedIds.length === 1 ? "tema" : "temas"} ·{" "}
          {estPods} estaciones
        </span>
        <button
          type="button"
          className="cta"
          disabled={selectedIds.length === 0 || assembling}
          onClick={startJourney}
        >
          {assembling ? "Ensamblando…" : "Iniciar viaje →"}
        </button>
      </footer>
    </section>
  );
}
