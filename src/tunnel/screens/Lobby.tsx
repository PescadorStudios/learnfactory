// ============================================================================
// LOBBY — pantalla de selección (Flujo del usuario, paso 1).
// ----------------------------------------------------------------------------
// Lista las lecciones del provider para que el usuario arme su viaje. Pensado
// para CRECER: cuando hay muchas rutas, navegar una lista plana es imposible.
// Por eso el lobby ofrece:
//   • BÚSQUEDA por nombre/categoría (sin acentos ni mayúsculas).
//   • CATEGORÍAS: las lecciones se agrupan por su `niche` (la dimensión
//     "categoría" del contrato; el color sale del mismo hash del tema). Chips
//     para filtrar rápido y "Añadir/Quitar todo" por categoría.
//   • VIAJE ALEATORIO: arma el túnel solo con 3-5 temas al azar y arranca.
// La selección vive en el store (no en el filtro): buscar/filtrar nunca la borra.
// Sigue agnóstico: todo sale de los datos del provider, nada temático se hardcodea.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { useJourney } from "../state/journeyStore";
import { colorForNiche } from "../theme";

/** Normaliza para buscar sin acentos ni mayúsculas ("Histórica" ~ "historica"). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const ALL = "__all__";

export function Lobby() {
  const catalog = useJourney((s) => s.catalog);
  const catalogStatus = useJourney((s) => s.catalogStatus);
  const selectedIds = useJourney((s) => s.selectedIds);
  const assembling = useJourney((s) => s.assembling);
  const error = useJourney((s) => s.error);
  const loadCatalog = useJourney((s) => s.loadCatalog);
  const toggleSelect = useJourney((s) => s.toggleSelect);
  const toggleMany = useJourney((s) => s.toggleMany);
  const clearSelection = useJourney((s) => s.clearSelection);
  const startJourney = useJourney((s) => s.startJourney);
  const assembleRandom = useJourney((s) => s.assembleRandom);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>(ALL);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Categorías = nichos únicos (la dimensión "categoría" del contrato), con conteo.
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of catalog) map.set(l.niche, (map.get(l.niche) ?? 0) + 1);
    return Array.from(map, ([niche, count]) => ({
      niche,
      count,
      color: colorForNiche(niche),
    })).sort((a, b) => a.niche.localeCompare(b.niche));
  }, [catalog]);

  // Si la categoría activa desaparece (catálogo recargado), vuelve a "todas".
  useEffect(() => {
    if (activeCat !== ALL && !categories.some((c) => c.niche === activeCat)) {
      setActiveCat(ALL);
    }
  }, [categories, activeCat]);

  // Filtro por texto (sin acentos) + categoría activa.
  const filtered = useMemo(() => {
    const q = norm(query);
    return catalog.filter((l) => {
      if (activeCat !== ALL && l.niche !== activeCat) return false;
      if (!q) return true;
      return (
        norm(l.title).includes(q) ||
        norm(l.niche).includes(q) ||
        norm(l.blurb).includes(q)
      );
    });
  }, [catalog, query, activeCat]);

  // Agrupa el resultado por categoría (orden alfabético de nicho).
  const groups = useMemo(() => {
    const by = new Map<string, typeof filtered>();
    for (const l of filtered) {
      const arr = by.get(l.niche) ?? [];
      arr.push(l);
      by.set(l.niche, arr);
    }
    return Array.from(by, ([niche, lessons]) => ({
      niche,
      color: colorForNiche(niche),
      lessons,
    })).sort((a, b) => a.niche.localeCompare(b.niche));
  }, [filtered]);

  const estPods = catalog
    .filter((l) => selectedIds.includes(l.id))
    .reduce((n, l) => n + l.estPods, 0);

  const ready = catalogStatus === "ready";
  const hasResults = filtered.length > 0;

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
          Busca por tema o categoría, arma tu propia ruta — o deja que el túnel
          se monte solo. Se ensambla en vivo a partir de tu selección.
        </p>
      </header>

      {/* ---- Barra (pegajosa): búsqueda + viaje aleatorio. ------------------ */}
      <div className="lobby__toolbar">
        <div className="lobby__search">
          <svg
            className="lobby__search-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <line
              x1="16.5"
              y1="16.5"
              x2="21"
              y2="21"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            className="lobby__search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tema o categoría…"
            aria-label="Buscar tema o categoría"
          />
          {query && (
            <button
              type="button"
              className="lobby__search-clear"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery("")}
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="button"
          className="lobby__random"
          onClick={assembleRandom}
          disabled={!ready || catalog.length === 0 || assembling}
          title="Arma un viaje sorpresa con temas al azar"
        >
          🎲 Viaje aleatorio
        </button>
      </div>

      {/* ---- Chips de categoría (filtro rápido). ---------------------------- */}
      {ready && categories.length > 1 && (
        <div className="cat-chips" aria-label="Filtrar por categoría">
          <button
            type="button"
            aria-pressed={activeCat === ALL}
            className={`cat-chip ${activeCat === ALL ? "cat-chip--on" : ""}`}
            onClick={() => setActiveCat(ALL)}
          >
            Todas <span className="cat-chip__count">{catalog.length}</span>
          </button>
          {categories.map((c) => {
            const on = activeCat === c.niche;
            return (
              <button
                key={c.niche}
                type="button"
                aria-pressed={on}
                className={`cat-chip ${on ? "cat-chip--on" : ""}`}
                onClick={() => setActiveCat(on ? ALL : c.niche)}
                style={
                  on
                    ? { borderColor: c.color, color: c.color, boxShadow: `0 0 0 1px ${c.color}` }
                    : undefined
                }
              >
                <span className="cat-chip__dot" style={{ background: c.color }} aria-hidden />
                {c.niche} <span className="cat-chip__count">{c.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {catalogStatus === "loading" && <p className="muted">Cargando lecciones…</p>}
      {catalogStatus === "error" && (
        <p className="error">No se pudo cargar el contenido. {error}</p>
      )}

      {ready && !hasResults && (
        <div className="lobby__empty">
          <p className="lobby__empty-title">Sin resultados</p>
          <p className="muted">
            {query ? <>Nada coincide con «{query}». </> : "No hay temas en esta categoría. "}
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setQuery("");
                setActiveCat(ALL);
              }}
            >
              Ver todos
            </button>
          </p>
        </div>
      )}

      {/* ---- Secciones por categoría. -------------------------------------- */}
      {groups.map((g) => {
        const ids = g.lessons.map((l) => l.id);
        const allOn = ids.every((id) => selectedIds.includes(id));
        return (
          <section key={g.niche} className="cat-section">
            <div className="cat-section__head">
              <span className="cat-section__bar" aria-hidden style={{ background: g.color }} />
              <h2 className="cat-section__name">{g.niche}</h2>
              <span className="cat-section__count">{g.lessons.length}</span>
              <button
                type="button"
                className="cat-section__all"
                onClick={() => toggleMany(ids)}
              >
                {allOn ? "Quitar todo" : "Añadir todo"}
              </button>
            </div>
            <ul className="cards">
              {g.lessons.map((l) => {
                const on = selectedIds.includes(l.id);
                const color = g.color;
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
                      <span className="card__accent" aria-hidden style={{ background: color }} />
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
                          style={on ? { background: color, color: "#06070d", borderColor: color } : undefined}
                        >
                          {on ? "✓" : "+"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <footer className="lobby__foot">
        <span className="muted">
          {selectedIds.length} {selectedIds.length === 1 ? "tema" : "temas"} ·{" "}
          {estPods} estaciones
          {selectedIds.length > 0 && (
            <>
              {" · "}
              <button type="button" className="linkish" onClick={clearSelection}>
                limpiar
              </button>
            </>
          )}
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
