"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight, BookOpen, BrainCircuit, Star, LogOut, Loader2, Map, ChevronRight } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getMyRoutes } from "./routeActions";
import type { RouteSummary } from "@/lib/types";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const router = useRouter();
  const { session, loading, token, email } = useRequireAuth();

  const examples = [
    "Inteligencia Artificial",
    "Storytelling",
    "Medicina funcional",
    "Ventas B2B",
    "Griego bíblico",
    "Producción de video",
  ];

  useEffect(() => {
    if (!token) return;
    getMyRoutes(token).then(setRoutes);
  }, [token]);

  if (loading || !session) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </main>
    );
  }

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    router.push(`/sources?topic=${encodeURIComponent(topic)}`);
  };

  const handleLogout = async () => {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
  };

  return (
    <main className="min-h-screen flex flex-col items-center p-4 pt-6 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-secondary/20 blur-[120px] pointer-events-none" />

      {/* Barra de usuario */}
      <div className="w-full max-w-2xl flex justify-end items-center gap-3 z-10 mb-8">
        <span className="text-zinc-500 text-sm">{email}</span>
        <button
          onClick={handleLogout}
          className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1 text-sm"
        >
          <LogOut className="w-4 h-4" /> Salir
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full max-w-2xl z-10 flex flex-col items-center text-center"
      >
        <div className="flex items-center gap-2 mb-6 bg-zinc-900/50 border border-zinc-800 px-4 py-2 rounded-full text-zinc-400 text-sm">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>Tu academia personalizada impulsada por IA</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
          ¿Qué quieres <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">dominar?</span>
        </h1>

        <p className="text-zinc-400 text-lg mb-10 max-w-xl">
          LearnFactory genera rutas de aprendizaje adaptativas, microlecciones y simulaciones para que domines cualquier tema del mundo real.
        </p>

        <form onSubmit={handleStart} className="w-full relative max-w-xl mb-8">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Ej: Teología del pacto, Bitcoin, Finanzas..."
            className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl py-4 pl-6 pr-16 text-lg text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all shadow-2xl"
          />
          <button
            type="submit"
            disabled={!topic.trim()}
            className="absolute right-2 top-2 bottom-2 bg-primary hover:bg-primary-hover text-white rounded-xl px-4 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        {/* Mis rutas */}
        {routes === null ? (
          <div className="flex items-center gap-2 text-zinc-600 text-sm mb-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando tus rutas...
          </div>
        ) : routes.length > 0 ? (
          <div className="w-full max-w-xl mb-10 text-left">
            <h2 className="text-zinc-400 font-bold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
              <Map className="w-4 h-4" /> Mis rutas
            </h2>
            <div className="space-y-3">
              {routes.map((r, i) => {
                const pct = r.totalNodes > 0 ? Math.round((r.completedNodes / r.totalNodes) * 100) : 0;
                return (
                  <motion.button
                    key={r.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                    onClick={() => router.push(`/tree?route=${r.id}`)}
                    className="w-full bg-zinc-900/80 border border-zinc-800 hover:border-primary rounded-2xl p-4 transition-all text-left flex items-center gap-4 group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-white truncate">{r.topic}</h3>
                        {r.status === "generating" && (
                          <span className="text-xs text-amber-400 flex items-center gap-1 shrink-0">
                            <Loader2 className="w-3 h-3 animate-spin" /> generando
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span>{r.completedNodes}/{r.totalNodes} lecciones · {pct}%</span>
                        {r.avgStars !== null && (
                          <span className="flex items-center gap-1 text-amber-400">
                            <Star className="w-3 h-3 fill-current" /> {r.avgStars}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary to-accent rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-primary transition-colors shrink-0" />
                  </motion.button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-3 max-w-lg pb-10">
          <span className="text-zinc-500 text-sm mr-2 w-full mb-2">Sugerencias populares:</span>
          {examples.map((ex, i) => (
            <motion.button
              key={ex}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              onClick={() => setTopic(ex)}
              className="px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-2"
            >
              {i % 2 === 0 ? <BrainCircuit className="w-3 h-3 text-secondary" /> : <BookOpen className="w-3 h-3 text-accent" />}
              {ex}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </main>
  );
}
