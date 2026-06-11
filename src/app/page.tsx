"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Plus, ChevronRight, Star, Crown, Users, Layers } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getMyRoutes } from "./routeActions";
import { getLibrary, getFeaturedCreators, searchPublicRoutes, getMyProfile, getPlan } from "./socialActions";
import type { RouteSummary, LibrarySection, FeaturedCreator, RouteCard as RouteCardData, PlanState } from "@/lib/types";
import AppHeader from "@/components/AppHeader";
import RouteRow from "@/components/RouteRow";
import RouteCard from "@/components/RouteCard";
import { Logo, LogoMark } from "@/components/Logo";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
  const { session, loading, token } = useRequireAuth();

  const [myRoutes, setMyRoutes] = useState<RouteSummary[] | null>(null);
  const [sections, setSections] = useState<LibrarySection[] | null>(null);
  const [creators, setCreators] = useState<FeaturedCreator[]>([]);
  const [results, setResults] = useState<RouteCardData[] | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);

  // Onboarding: si no hay username, ir a ajustes
  useEffect(() => {
    if (!token) return;
    getMyProfile(token).then(p => {
      if (p && !p.username) router.replace("/settings/profile?onboarding=1");
    });
  }, [token, router]);

  const loadHome = useCallback(async () => {
    if (!token) return;
    const [routes, lib, feat, p] = await Promise.all([getMyRoutes(token), getLibrary(token), getFeaturedCreators(token), getPlan(token)]);
    setMyRoutes(routes);
    setSections(lib);
    setCreators(feat);
    setPlan(p);
  }, [token]);

  useEffect(() => {
    if (query) return; // en modo búsqueda no cargamos el home
    loadHome();
  }, [loadHome, query]);

  useEffect(() => {
    if (!token || !query) { setResults(null); return; }
    searchPublicRoutes(token, query).then(setResults);
  }, [token, query]);

  if (loading || !session) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950">
      <AppHeader initialQuery={query} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {query ? (
          // ── Resultados de búsqueda ──
          <div>
            <h1 className="text-2xl font-bold text-white mb-6">
              Resultados para <span className="text-primary">&quot;{query}&quot;</span>
            </h1>
            {results === null ? (
              <div className="flex items-center gap-2 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /> Buscando...</div>
            ) : results.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-zinc-400 mb-4">No encontramos rutas públicas sobre eso todavía.</p>
                <button onClick={() => router.push(`/sources?topic=${encodeURIComponent(query)}`)} className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-6 py-3 font-bold transition-all">
                  <Plus className="w-4 h-4" /> Crea la primera ruta de &quot;{query}&quot;
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {results.map(r => <RouteCard key={r.id} route={r} compact />)}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Hero */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl bg-gradient-to-br from-primary/20 via-zinc-900 to-secondary/20 border border-zinc-800 p-8 md:p-12 mb-10 relative overflow-hidden"
            >
              <div className="absolute top-[-30%] right-[-10%] w-[40%] h-[120%] rounded-full bg-primary/20 blur-[100px] pointer-events-none" />
              {/* Símbolo de marca como marca de agua imponente */}
              <LogoMark className="hidden md:block absolute -right-8 -top-8 w-64 h-64 opacity-[0.07] rotate-12 pointer-events-none" />
              <div className="relative z-10 max-w-2xl">
                <Logo className="h-12 md:h-16 mb-6" glow />
                <div className="inline-flex items-center gap-2 mb-4 bg-zinc-950/50 border border-zinc-800 px-3 py-1.5 rounded-full text-zinc-300 text-xs">
                  <LogoMark className="w-3.5 h-3.5" /> Biblioteca colectiva de conocimiento
                </div>
                <h1 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">
                  Aprende cualquier tema. <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Crea el tuyo.</span>
                </h1>
                <p className="text-zinc-400 text-base md:text-lg mb-6 max-w-xl">
                  Explora rutas creadas por la comunidad o genera la tuya con IA: podcast, lecciones, debates y exámenes.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => router.push("/sources")}
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-6 py-3 font-bold transition-all"
                  >
                    <Plus className="w-5 h-5" /> Crear ruta nueva
                  </button>
                  {plan?.batchEnabled && (
                    <button
                      onClick={() => router.push("/batch")}
                      className="inline-flex items-center gap-2 bg-violet-500/15 border border-violet-500/50 text-violet-300 hover:bg-violet-500/25 rounded-full px-6 py-3 font-bold transition-all"
                    >
                      <Layers className="w-5 h-5" /> Crear rutas en lote
                    </button>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Mis rutas */}
            {myRoutes && myRoutes.length > 0 && (
              <section className="mb-10">
                <h2 className="text-lg md:text-xl font-bold text-white mb-3 px-1">Mis rutas</h2>
                <div className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1">
                  {myRoutes.map(r => {
                    const pct = r.totalNodes > 0 ? Math.round((r.completedNodes / r.totalNodes) * 100) : 0;
                    return (
                      <button
                        key={r.id}
                        onClick={() => router.push(`/route/${r.id}`)}
                        className="group shrink-0 w-60 text-left"
                      >
                        <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 group-hover:border-primary/60 transition-colors">
                          {r.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.coverUrl} alt={r.topic} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary/20" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                          {r.status === "generating" && (
                            <span className="absolute top-2 left-2 text-xs text-amber-300 bg-black/60 rounded-full px-2 py-0.5 flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" /> generando
                            </span>
                          )}
                          <div className="absolute bottom-0 inset-x-0 p-3">
                            <h3 className="font-bold text-white text-sm line-clamp-1">{r.topic}</h3>
                            <div className="mt-1.5 h-1 bg-zinc-700/60 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 px-0.5 text-xs text-zinc-500">
                          <span>{r.completedNodes}/{r.totalNodes} · {pct}%</span>
                          {r.avgStars !== null && <span className="flex items-center gap-1 text-amber-400 ml-auto"><Star className="w-3 h-3 fill-current" /> {r.avgStars}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Biblioteca pública */}
            {sections === null ? (
              <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando la biblioteca...</div>
            ) : sections.length === 0 ? (
              <div className="text-center py-16 text-zinc-500">Aún no hay rutas públicas. ¡Sé el primero en crear una!</div>
            ) : (
              sections.map(s => <RouteRow key={s.key} title={s.title} routes={s.routes} />)
            )}

            {/* Creadores destacados */}
            {creators.length > 0 && (
              <section className="mb-10">
                <h2 className="text-lg md:text-xl font-bold text-white mb-3 px-1 flex items-center gap-2">
                  <Crown className="w-5 h-5 text-amber-400" /> Creadores destacados
                </h2>
                <div className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1">
                  {creators.map(c => (
                    <button
                      key={c.username}
                      onClick={() => router.push(`/u/${c.username}`)}
                      className="shrink-0 w-40 bg-zinc-900/80 border border-zinc-800 hover:border-primary rounded-2xl p-4 flex flex-col items-center text-center transition-all"
                    >
                      <div className="w-16 h-16 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700 mb-2 flex items-center justify-center">
                        {c.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.avatarUrl} alt={c.username || ""} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xl font-bold text-zinc-500">{(c.displayName || c.username || "?")[0].toUpperCase()}</span>
                        )}
                      </div>
                      <p className="font-bold text-white text-sm truncate w-full">{c.displayName || `@${c.username}`}</p>
                      <p className="text-xs text-zinc-500 flex items-center gap-1 mt-1"><Users className="w-3 h-3" /> {c.studentTotal} · {c.routeCount} rutas</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="text-center pt-4 pb-12">
              <button onClick={() => router.push("/sources")} className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm">
                ¿No encuentras tu tema? Créalo con IA <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-950" />}>
      <HomeContent />
    </Suspense>
  );
}
