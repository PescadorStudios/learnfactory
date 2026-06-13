"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Plus, ChevronRight, Star, Crown, Users, Layers, Sparkles } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getMyRoutes } from "./routeActions";
import { getLibrary, getFeaturedCreators, searchPublicRoutes, getMyProfile, getPlan } from "./socialActions";
import type { RouteSummary, LibrarySection, FeaturedCreator, RouteCard as RouteCardData, PlanState } from "@/lib/types";
import AppHeader from "@/components/AppHeader";
import RouteRow from "@/components/RouteRow";
import RouteCard from "@/components/RouteCard";
import { Logo, LogoMark } from "@/components/Logo";
import { RankPill } from "@/components/ReputationBadge";
import { creatorRank } from "@/lib/reputation";

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
            {/* Hero — pieza central de la identidad */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="relative rounded-[2rem] overflow-hidden border border-zinc-800/80 bg-zinc-950 mb-12"
            >
              {/* Capa 1: gradientes radiales profundos */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(139,92,246,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(59,130,246,0.16),transparent_55%)] pointer-events-none" />
              {/* Capa 2: línea de luz superior */}
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent pointer-events-none" />
              {/* Capa 3: glow que respira */}
              <motion.div
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -top-40 right-0 w-[32rem] h-[32rem] rounded-full bg-primary/25 blur-[130px] pointer-events-none"
              />
              {/* Capa 4: símbolo monumental desvanecido */}
              <LogoMark className="hidden md:block absolute -right-20 top-1/2 -translate-y-1/2 w-[28rem] h-[28rem] opacity-[0.06] rotate-12 pointer-events-none" />

              <div className="relative z-10 px-8 md:px-14 py-12 md:py-16 max-w-3xl">
                {/* El logo ES el protagonista */}
                <motion.div
                  initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                >
                  <Logo className="h-20 md:h-32 mb-7" glow />
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.6 }}
                  className="text-3xl md:text-[3.4rem] md:leading-[1.08] font-bold mb-5 tracking-tight"
                >
                  Aprende cualquier tema.
                  <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary">
                    Crea el tuyo con IA.
                  </span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.6 }}
                  className="text-zinc-400 text-base md:text-lg mb-8 max-w-xl"
                >
                  La fábrica donde el conocimiento se convierte en rutas: podcast narrado,
                  juegos de atención, debates y exámenes — creados por la comunidad o por ti.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55, duration: 0.6 }}
                  className="flex flex-wrap gap-3"
                >
                  <button
                    onClick={() => router.push("/sources")}
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-7 py-3.5 font-bold transition-all shadow-[0_0_30px_rgba(139,92,246,0.35)] hover:shadow-[0_0_45px_rgba(139,92,246,0.5)]"
                  >
                    <Plus className="w-5 h-5" /> Crear ruta nueva
                  </button>
                  {plan?.batchEnabled && (
                    <button
                      onClick={() => router.push("/batch")}
                      className="inline-flex items-center gap-2 bg-zinc-900/80 border border-violet-500/40 text-violet-300 hover:bg-violet-500/15 hover:border-violet-400 rounded-full px-7 py-3.5 font-bold transition-all backdrop-blur-sm"
                    >
                      <Layers className="w-5 h-5" /> Crear rutas en lote
                    </button>
                  )}
                </motion.div>

                {/* Sellos de la fábrica */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.75, duration: 0.8 }}
                  className="mt-10 pt-6 border-t border-zinc-800/60 flex flex-wrap items-center gap-x-7 gap-y-2.5 text-xs text-zinc-500"
                >
                  <span className="inline-flex items-center gap-2">
                    <LogoMark className="w-4 h-4" /> Podcast narrado por IA
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-primary/70" /> 3 juegos de atención
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-secondary/70" /> Debates socráticos
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-accent/70" /> Biblioteca colectiva
                  </span>
                </motion.div>
              </div>
            </motion.div>

            {/* ── El Túnel: experiencia inmersiva (add-on de edu-entretenimiento) ──
                Sección destacada justo bajo el hero. Lleva a la ruta nativa /tunel,
                paralela a las rutas actuales — la app de siempre no cambia. */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="mb-12"
            >
              <button
                type="button"
                onClick={() => router.push("/tunel")}
                aria-label="Entrar a El Túnel"
                className="group relative w-full text-left rounded-[2rem] overflow-hidden border border-violet-500/25 hover:border-cyan-400/40 bg-[#06070d] transition-colors"
              >
                {/* Corredor: gradientes radiales cian/violeta (la paleta del túnel) */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_50%,rgba(56,189,248,0.16),transparent_55%),radial-gradient(circle_at_92%_50%,rgba(139,92,246,0.30),transparent_50%)] pointer-events-none" />
                {/* Boca del túnel: anillos concéntricos que respiran al hover */}
                <div className="absolute right-0 top-0 bottom-0 w-2/3 hidden md:grid place-items-center pointer-events-none" aria-hidden>
                  <div className="absolute w-72 h-72 rounded-full border border-cyan-400/10 transition-transform duration-700 group-hover:scale-110" />
                  <div className="absolute w-56 h-56 rounded-full border border-cyan-400/15 transition-transform duration-700 group-hover:scale-110" />
                  <div className="absolute w-40 h-40 rounded-full border border-violet-400/25 transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute w-24 h-24 rounded-full border border-violet-400/40" />
                  <div className="absolute w-10 h-10 rounded-full bg-gradient-to-br from-cyan-300/50 to-violet-500/50 blur-md transition-all group-hover:from-cyan-300/70 group-hover:to-violet-500/70" />
                </div>

                <div className="relative z-10 px-8 md:px-14 py-10 md:py-12 max-w-2xl">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300/90 mb-3">
                    <Sparkles className="w-3.5 h-3.5" /> Nuevo · Edu-entretenimiento
                  </span>
                  <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-200 to-violet-300">
                      El Túnel
                    </span>
                  </h2>
                  <p className="text-zinc-400 text-base md:text-lg mb-7 max-w-lg">
                    Atraviesa un corredor neuronal en 3D donde el conocimiento se
                    convierte en juego: narrado con la voz de Learn Factory, caza
                    subtítulos trampa y desenmascara impostores estación tras estación.
                  </p>
                  <span className="inline-flex items-center gap-2 bg-white/5 border border-cyan-400/40 text-white rounded-full px-7 py-3.5 font-bold transition-all group-hover:bg-cyan-400/10 group-hover:border-cyan-300 group-hover:shadow-[0_0_35px_rgba(56,189,248,0.35)]">
                    Entrar al Túnel
                    <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
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
                      <div className="mt-1.5"><RankPill track="creator" rank={creatorRank(c.graduates)} size="xs" /></div>
                      <p className="text-xs text-zinc-500 flex items-center gap-1 mt-1.5"><Users className="w-3 h-3" /> {c.studentTotal} · {c.routeCount} rutas</p>
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
