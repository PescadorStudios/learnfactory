"use client";

// Lobby del Modo Scroll: el usuario configura SU experiencia antes de entrar al
// feed. Tres modos: por Intereses (categorías), Rutas específicas, o Aleatorio
// (con posibilidad de excluir temas o rutas). Devuelve los filtros que consume
// getGlobalScrollFeed; el orden fino lo decide el feedRanker.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, ListVideo, Shuffle, Check, Search, Film } from "lucide-react";
import { categoryLabel } from "@/lib/types";
import { getScrollSources, type ScrollSources, type ScrollFeedFilters } from "@/app/scrollActions";

type Mode = "intereses" | "rutas" | "aleatorio";

const MODES: { id: Mode; label: string; icon: typeof Sparkles; blurb: string }[] = [
  { id: "intereses", label: "Intereses", icon: Sparkles, blurb: "Elige temas y arma tu feed con ellos." },
  { id: "rutas", label: "Rutas", icon: ListVideo, blurb: "Mira solo los cortos de rutas que elijas." },
  { id: "aleatorio", label: "Aleatorio", icon: Shuffle, blurb: "De todo un poco. Puedes excluir lo que no quieras." },
];

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v); else n.add(v);
  return n;
}

export default function ScrollLobby({
  token,
  onStart,
}: {
  token: string | null;
  onStart: (filters: ScrollFeedFilters) => void;
}) {
  const [sources, setSources] = useState<ScrollSources | null>(null);
  const [mode, setMode] = useState<Mode>("intereses");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [routeIds, setRouteIds] = useState<Set<string>>(new Set());
  const [exclCats, setExclCats] = useState<Set<string>>(new Set());
  const [exclRoutes, setExclRoutes] = useState<Set<string>>(new Set());
  const [showExclude, setShowExclude] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getScrollSources(token).then(setSources);
  }, [token]);

  const filteredRoutes = useMemo(() => {
    const list = sources?.routes ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter(r => r.topic.toLowerCase().includes(q)) : list;
  }, [sources, query]);

  if (!sources) {
    return (
      <div className="min-h-[100dvh] bg-black flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-fuchsia-500 animate-spin" />
      </div>
    );
  }

  if (sources.routes.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-black text-white flex flex-col items-center justify-center text-center px-8">
        <Film className="w-12 h-12 text-fuchsia-500/70 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Todavía no hay cortos</h1>
        <p className="text-zinc-500">Cuando una ruta genere sus videos, aparecerán aquí.</p>
      </div>
    );
  }

  const canStart =
    mode === "aleatorio" || (mode === "intereses" && cats.size > 0) || (mode === "rutas" && routeIds.size > 0);

  const start = () => {
    if (mode === "intereses") onStart({ categories: [...cats] });
    else if (mode === "rutas") onStart({ routeIds: [...routeIds] });
    else onStart({ excludeCategories: [...exclCats], excludeRouteIds: [...exclRoutes] });
  };

  return (
    <main className="min-h-[100dvh] bg-gradient-to-b from-zinc-950 via-black to-zinc-950 text-white">
      <div className="max-w-2xl mx-auto px-5 py-10">
        <div className="flex items-center gap-2 text-fuchsia-400 text-xs font-bold uppercase tracking-[0.2em] mb-2">
          <Film className="w-4 h-4" /> Modo Scroll
        </div>
        <h1 className="text-3xl font-black mb-1">Configura tu experiencia</h1>
        <p className="text-zinc-400 mb-6">Aprende a conciencia lo que tú quieras. Elige cómo quieres que se arme tu feed.</p>

        {/* Selector de modo */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          {MODES.map(m => {
            const Icon = m.icon;
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-2xl border p-3 text-left transition-all ${on ? "border-fuchsia-500 bg-fuchsia-500/10" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"}`}
              >
                <Icon className={`w-5 h-5 mb-1.5 ${on ? "text-fuchsia-300" : "text-zinc-400"}`} />
                <p className="font-bold text-sm">{m.label}</p>
              </button>
            );
          })}
        </div>
        <p className="text-zinc-500 text-sm mb-5">{MODES.find(m => m.id === mode)!.blurb}</p>

        {/* Contenido por modo */}
        {mode === "intereses" && (
          <div className="flex flex-wrap gap-2 mb-8">
            {sources.categories.map(c => {
              const on = cats.has(c);
              return (
                <button
                  key={c}
                  onClick={() => setCats(s => toggle(s, c))}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold border transition-all ${on ? "bg-fuchsia-500/20 border-fuchsia-500/50 text-fuchsia-200" : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700"}`}
                >
                  {on && <Check className="w-3.5 h-3.5" />} {categoryLabel(c)}
                </button>
              );
            })}
          </div>
        )}

        {mode === "rutas" && (
          <div className="mb-8">
            <RouteSearch query={query} setQuery={setQuery} />
            <RouteList routes={filteredRoutes} selected={routeIds} onToggle={id => setRouteIds(s => toggle(s, id))} />
          </div>
        )}

        {mode === "aleatorio" && (
          <div className="mb-8">
            <p className="text-zinc-300 text-sm mb-3">Verás cortos de todas las rutas, mezclados según tus intereses y repaso.</p>
            <button onClick={() => setShowExclude(v => !v)} className="text-fuchsia-300 text-sm font-bold underline-offset-2 hover:underline mb-3">
              {showExclude ? "Ocultar exclusiones" : "Excluir temas o rutas (opcional)"}
            </button>
            {showExclude && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500 font-bold mb-2">Excluir temas</p>
                  <div className="flex flex-wrap gap-2">
                    {sources.categories.map(c => {
                      const on = exclCats.has(c);
                      return (
                        <button
                          key={c}
                          onClick={() => setExclCats(s => toggle(s, c))}
                          className={`rounded-full px-3.5 py-1.5 text-sm font-bold border transition-all ${on ? "bg-rose-500/20 border-rose-500/50 text-rose-200 line-through" : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700"}`}
                        >
                          {categoryLabel(c)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500 font-bold mb-2">Excluir rutas</p>
                  <RouteSearch query={query} setQuery={setQuery} />
                  <RouteList routes={filteredRoutes} selected={exclRoutes} onToggle={id => setExclRoutes(s => toggle(s, id))} danger />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empezar */}
        <button
          onClick={start}
          disabled={!canStart}
          className="w-full inline-flex items-center justify-center gap-2 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl py-4 font-bold text-lg transition-all"
        >
          <Film className="w-5 h-5" /> Empezar a ver
        </button>
        {!canStart && (
          <p className="text-zinc-600 text-xs text-center mt-2">
            {mode === "intereses" ? "Elige al menos un tema." : "Elige al menos una ruta."}
          </p>
        )}
      </div>
    </main>
  );
}

function RouteSearch({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
  return (
    <div className="relative mb-3">
      <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Buscar ruta…"
        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-fuchsia-500"
      />
    </div>
  );
}

function RouteList({
  routes,
  selected,
  onToggle,
  danger = false,
}: {
  routes: { routeId: string; topic: string; category: string; coverUrl: string | null }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  danger?: boolean;
}) {
  return (
    <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
      {routes.map(r => {
        const on = selected.has(r.routeId);
        const ring = on ? (danger ? "border-rose-500/60 bg-rose-500/10" : "border-fuchsia-500/60 bg-fuchsia-500/10") : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700";
        return (
          <button
            key={r.routeId}
            onClick={() => onToggle(r.routeId)}
            className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition-all ${ring}`}
          >
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
              {r.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 text-zinc-600" /></div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{r.topic}</p>
              <p className="text-xs text-zinc-500">{categoryLabel(r.category)}</p>
            </div>
            <span className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${on ? (danger ? "bg-rose-500 border-rose-500" : "bg-fuchsia-500 border-fuchsia-500") : "border-zinc-700"}`}>
              {on && <Check className="w-4 h-4 text-white" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
