"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Shuffle, Play, Check, Plus, Headphones, BookOpen } from "lucide-react";
import type { PodcastRouteGroup } from "@/app/routeActions";
import { type PodcastTrack, trackId } from "./types";

/** Normaliza para buscar sin acentos ni mayúsculas. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function fmtDur(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export default function PodcastLobby({
  catalog,
  onPlay,
}: {
  catalog: PodcastRouteGroup[];
  onPlay: (tracks: PodcastTrack[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Todas las lecciones como pistas (con el tema de su ruta), por id.
  const allTracks = useMemo(() => {
    const map = new Map<string, PodcastTrack>();
    for (const g of catalog) {
      for (const l of g.lessons) map.set(trackId(l), { ...l, routeTopic: g.topic });
    }
    return map;
  }, [catalog]);

  // Filtro por texto: rutas cuyo tema o alguna lección coincide.
  const groups = useMemo(() => {
    const q = norm(query);
    if (!q) return catalog;
    return catalog
      .map((g) => {
        if (norm(g.topic).includes(q)) return g;
        const lessons = g.lessons.filter((l) => norm(l.title).includes(q));
        return lessons.length ? { ...g, lessons } : null;
      })
      .filter((g): g is PodcastRouteGroup => g !== null);
  }, [catalog, query]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleRoute = (g: PodcastRouteGroup) => {
    const ids = g.lessons.map(trackId);
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  // Cola en el orden del catálogo (rutas alfabéticas, lecciones en orden de árbol).
  const buildQueue = (): PodcastTrack[] => {
    const out: PodcastTrack[] = [];
    for (const g of catalog) {
      for (const l of g.lessons) {
        if (selected.has(trackId(l))) out.push({ ...l, routeTopic: g.topic });
      }
    }
    return out;
  };

  const playRandom = () => {
    const all = [...allTracks.values()];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    if (all.length) onPlay(all);
  };

  const selectedCount = selected.size;
  const totalDur = useMemo(() => {
    let s = 0;
    for (const id of selected) s += allTracks.get(id)?.durationSeconds ?? 0;
    return s;
  }, [selected, allTracks]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-32">
      {/* Encabezado */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-2xl bg-primary/15 border border-primary/40 flex items-center justify-center">
          <Headphones className="w-5 h-5 text-primary" />
        </div>
        <h1 className="text-3xl font-bold">Modo Podcast</h1>
      </div>
      <p className="text-zinc-500 mb-6">
        Elige lecciones, rutas enteras o deja que suene al azar. Se reproducen una
        tras otra sin parar — ideal para dormir, manejar o salir a caminar.
      </p>

      {/* Barra: búsqueda + aleatorio */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tema o lección..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-11 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={playRandom}
          disabled={allTracks.size === 0}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 font-bold hover:border-primary transition-colors disabled:opacity-40"
        >
          <Shuffle className="w-4 h-4" /> Aleatorio
        </button>
      </div>

      {catalog.length === 0 ? (
        <p className="text-zinc-500 py-16 text-center">
          Aún no hay lecciones de audio disponibles para escuchar.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-zinc-500 py-16 text-center">Nada coincide con «{query}».</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const ids = g.lessons.map(trackId);
            const allOn = ids.every((id) => selected.has(id));
            const groupDur = g.lessons.reduce((n, l) => n + l.durationSeconds, 0);
            return (
              <section key={g.routeId}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                    {g.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.coverUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <BookOpen className="w-5 h-5 text-zinc-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-white truncate">{g.topic}</h2>
                    <p className="text-xs text-zinc-500">{g.lessons.length} lecciones · {fmtDur(groupDur)}</p>
                  </div>
                  <button
                    onClick={() => toggleRoute(g)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                      allOn ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-white"
                    }`}
                  >
                    {allOn ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    {allOn ? "Quitar ruta" : "Añadir ruta"}
                  </button>
                </div>

                <ul className="space-y-2">
                  {g.lessons.map((l) => {
                    const id = trackId(l);
                    const on = selected.has(id);
                    return (
                      <li key={id}>
                        <button
                          onClick={() => toggle(id)}
                          className={`w-full flex items-center gap-3 text-left rounded-2xl border p-3 transition-colors ${
                            on ? "bg-primary/10 border-primary/40" : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                          }`}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-zinc-100 truncate">{l.title}</span>
                            <span className="block text-xs text-zinc-500">{fmtDur(l.durationSeconds)}</span>
                          </span>
                          <span
                            className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center ${
                              on ? "bg-primary text-white border-primary" : "border-zinc-700 text-zinc-500"
                            }`}
                          >
                            {on ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Footer fijo: selección + reproducir */}
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 80 }}
          animate={{ y: 0 }}
          className="fixed bottom-0 inset-x-0 z-40 bg-zinc-950/95 backdrop-blur border-t border-zinc-800"
        >
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <span className="text-sm text-zinc-300">
              <span className="font-bold text-white">{selectedCount}</span>{" "}
              {selectedCount === 1 ? "lección" : "lecciones"} · {fmtDur(totalDur)}
              <button onClick={() => setSelected(new Set())} className="ml-3 text-zinc-500 hover:text-white text-xs underline">
                limpiar
              </button>
            </span>
            <button
              onClick={() => onPlay(buildQueue())}
              className="ml-auto inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary text-white font-bold hover:bg-primary-hover transition-all"
            >
              <Play className="w-5 h-5 fill-current" /> Reproducir
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
