"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Lock, CheckCircle2, Star, Trophy, Loader2, Sparkles, Flame, RefreshCw, Clock, AlertTriangle, Home, Info, Wand2, X } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { useRouteRealtime } from "@/lib/useRouteRealtime";
import { getRoute, retryLesson, resumeRoute, regenerateLesson } from "../routeActions";
import type { RouteDetail, TreeNode, NodeState } from "@/lib/types";

const NODE_TYPE_LABELS: Record<string, string> = {
  theory: "Teoría",
  practice: "Práctica",
  debate: "Debate",
  quiz: "Quiz",
  boss: "Boss",
};

function TreeLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white">
      <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
      <p className="text-zinc-400">Cargando tu ruta...</p>
    </div>
  );
}

/** Estrellas 0-5 con soporte de medias */
function StarRow({ value, size = "w-3.5 h-3.5" }: { value: number; size?: string }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`${size} ${
            value >= i ? "text-amber-400 fill-current" :
            value >= i - 0.5 ? "text-amber-400/60 fill-current" :
            "text-zinc-700"
          }`}
        />
      ))}
    </div>
  );
}

function KnowledgeTree() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeId = searchParams.get("route") || "";
  const completedNode = searchParams.get("completedNode") || "";
  const gainedXp = parseInt(searchParams.get("xp") || "0", 10) || 0;
  const gainedStars = parseFloat(searchParams.get("stars") || "0") || 0;
  const isNewBest = searchParams.get("best") === "1";

  const { token, loading: authLoading, session } = useRequireAuth();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [stalledPolls, setStalledPolls] = useState(0);
  // Regeneración guiada (solo dueño): nodo objetivo + prompt opcional
  const [regenNode, setRegenNode] = useState<TreeNode | null>(null);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !routeId) return;
    const data = await getRoute(token, routeId);
    if (data) setRoute(data);
    else setNotFound(true);
  }, [token, routeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Websocket: cada lección del lote aparece en su placeholder al completarse
  useRouteRealtime(routeId, load);

  // Polling de respaldo (por si el websocket falla) mientras haya generación
  useEffect(() => {
    if (!route) return;
    const generating = route.status === "generating" ||
      Object.values(route.nodes).some(n => n.status === "pending" || n.status === "generating");
    if (!generating) return;
    const interval = setInterval(load, 12000);
    return () => clearInterval(interval);
  }, [route, load]);

  useEffect(() => {
    if (completedNode) {
      setShowCelebration(true);
      const t = setTimeout(() => setShowCelebration(false), 3500);
      return () => clearTimeout(t);
    }
  }, [completedNode]);

  // Cola parada: hay lecciones en cola pero ninguna se está generando.
  // Se confirma en 2 sondeos seguidos (~10 s) para no saltar justo al crear la ruta.
  useEffect(() => {
    if (!route) return;
    const states = Object.values(route.nodes);
    const hasPending = states.some(n => n.status === "pending");
    const activelyGenerating = states.some(n => n.status === "generating" && !n.stale);
    setStalledPolls(c => (hasPending && !activelyGenerating ? c + 1 : 0));
  }, [route]);

  if (authLoading || !session) return <TreeLoading />;
  if (notFound) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Ruta no encontrada</h2>
        <button onClick={() => router.push("/")} className="mt-4 px-8 py-4 rounded-2xl font-bold bg-primary text-white hover:bg-primary-hover transition-all">
          Volver al inicio
        </button>
      </div>
    );
  }
  if (!route) return <TreeLoading />;

  // Progresión: completado = tiene bestStars; desbloqueado = primer no completado
  const allNodes = route.tree.levels.flatMap(l => l.nodes);
  const completedIds = new Set(allNodes.filter(n => route.nodes[n.id]?.bestStars !== null).map(n => n.id));
  const firstIncomplete = allNodes.find(n => !completedIds.has(n.id));

  const nodeUiStatus = (node: TreeNode): "completed" | "unlocked" | "locked" => {
    if (completedIds.has(node.id)) return "completed";
    if (firstIncomplete?.id === node.id) return "unlocked";
    return "locked";
  };

  const completedCount = completedIds.size;
  const totalNodes = allNodes.length;
  const progressPercent = totalNodes > 0 ? Math.round((completedCount / totalNodes) * 100) : 0;
  const stillGenerating = Object.values(route.nodes).filter(n => n.status === "pending" || n.status === "generating").length;

  const openNode = (node: TreeNode) => {
    router.push(`/lesson?route=${routeId}&node=${node.id}`);
  };

  const handleRetry = async (nodeId: string) => {
    if (!token) return;
    setRetrying(nodeId);
    await retryLesson(token, routeId, nodeId);
    await load();
    setRetrying(null);
  };

  const handleResume = async () => {
    if (!token) return;
    setResuming(true);
    await resumeRoute(token, routeId);
    setStalledPolls(0); // ocultar el aviso; si sigue parada, reaparece en ~10 s
    await load();
    setResuming(false);
  };

  const handleRegenerate = async () => {
    if (!token || !regenNode) return;
    setRegenBusy(true);
    await regenerateLesson(token, routeId, regenNode.id, regenPrompt.trim() || undefined);
    setRegenBusy(false);
    setRegenNode(null);
    setRegenPrompt("");
    await load();
  };

  // Lecciones recuperables: en error o atascadas (proceso huérfano).
  const recoverableCount = Object.values(route.nodes).filter(
    n => n.status === "error" || (n.status === "generating" && n.stale)
  ).length;
  // Cola en pausa confirmada: pendientes sin actividad durante 2+ sondeos.
  const queueStalled = stalledPolls >= 2;
  const showResume = recoverableCount > 0 || queueStalled;

  return (
    <main className="min-h-screen bg-zinc-950 px-3 py-6 sm:p-6 md:p-12 relative overflow-y-auto overflow-x-hidden">
      <div className="fixed top-0 inset-x-0 h-96 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />

      {/* Celebración al completar un nodo */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: -50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: -50 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-primary/90 backdrop-blur-md text-white px-8 py-4 rounded-2xl flex flex-col items-center gap-1 shadow-2xl shadow-primary/30"
          >
            <div className="flex items-center gap-3">
              <Sparkles className="w-6 h-6" />
              <span className="font-bold text-lg">
                {isNewBest ? "¡Nuevo récord!" : "¡Completado!"}{gainedXp > 0 ? ` +${gainedXp} XP` : ""}
              </span>
              <Sparkles className="w-6 h-6" />
            </div>
            {gainedStars > 0 && <StarRow value={gainedStars} size="w-4 h-4" />}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-3xl mx-auto relative z-10 pt-10">
        <header className="mb-12 text-center">
          {/* Stats */}
          <div className="flex flex-wrap justify-center items-center gap-2 sm:gap-3 mb-6">
            <button onClick={() => router.push("/")} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2 text-zinc-400 hover:text-white transition-colors">
              <Home className="w-4 h-4" />
            </button>
            <button onClick={() => router.push(`/route/${routeId}`)} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2 text-zinc-400 hover:text-white transition-colors" title="Ver ficha de la ruta">
              <Info className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2">
              <Star className="w-4 h-4 text-amber-400 fill-current" />
              <span className="font-bold text-sm text-white">{route.xpTotal} XP</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2">
              <Flame className={`w-4 h-4 ${route.streakDays > 0 ? "text-orange-500 fill-current" : "text-zinc-600"}`} />
              <span className="font-bold text-sm text-white">{route.streakDays} {route.streakDays === 1 ? "día" : "días"}</span>
            </div>
          </div>

          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-4"
          >
            <Trophy className="w-8 h-8 text-primary" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl md:text-5xl font-bold mb-4 break-words px-2"
          >
            Ruta de <span className="text-primary">{route.topic}</span>
          </motion.h1>

          {stillGenerating > 0 && !showResume && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-amber-400/90 text-sm mb-4 flex items-center justify-center gap-2"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Generando {stillGenerating} {stillGenerating === 1 ? "lección" : "lecciones"} con audio en segundo plano...
            </motion.p>
          )}

          {showResume && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-4 flex flex-col items-center gap-2"
            >
              <p className="text-rose-400/90 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {recoverableCount > 0
                  ? `${recoverableCount} ${recoverableCount === 1 ? "lección se interrumpió" : "lecciones se interrumpieron"} al generar.`
                  : "La generación quedó en pausa con lecciones en cola."}
              </p>
              <button
                onClick={handleResume}
                disabled={resuming}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm bg-rose-500 text-white hover:bg-rose-400 transition-all disabled:opacity-60"
              >
                {resuming ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Reanudar generación
              </button>
            </motion.div>
          )}

          {/* Barra de progreso global */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="max-w-md mx-auto"
          >
            <div className="flex justify-between text-sm mb-2">
              <span className="text-zinc-500">Progreso</span>
              <span className="text-primary font-bold">{completedCount}/{totalNodes} lecciones · {progressPercent}%</span>
            </div>
            <div className="h-3 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-accent rounded-full relative"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ type: "spring", stiffness: 40, delay: 0.5 }}
              >
                <div className="absolute top-0 left-0 right-0 h-1/2 bg-white/20 rounded-full" />
              </motion.div>
            </div>
          </motion.div>
        </header>

        <div className="space-y-12 pb-24">
          {route.tree.levels.map((level, levelIndex) => (
            <motion.div
              key={level.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: levelIndex * 0.15 }}
              className="relative"
            >
              {levelIndex !== route.tree.levels.length - 1 && (
                <div className="absolute left-5 sm:left-8 top-20 sm:top-24 bottom-[-3rem] w-0.5 bg-zinc-800" />
              )}

              <div className="flex items-start gap-3 sm:gap-6">
                <div className="w-10 h-10 sm:w-16 sm:h-16 shrink-0 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center font-bold text-base sm:text-xl text-zinc-500 z-10 relative">
                  {level.id}
                </div>
                <div className="flex-1 min-w-0 pt-1 sm:pt-2">
                  <h2 className="text-lg sm:text-2xl font-bold mb-1 break-words">{level.title}</h2>
                  <p className="text-zinc-500 text-sm mb-6">{level.description}</p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {level.nodes.map((node) => {
                      const state: NodeState = route.nodes[node.id] || { status: "pending", error: null, bestStars: null, attemptCount: 0, mastery: null, reviewDue: false, stale: false };
                      const uiStatus = nodeUiStatus(node);
                      const isCompleted = uiStatus === "completed";
                      const isUnlocked = uiStatus === "unlocked";
                      const isReady = state.status === "ready";
                      const isStale = state.status === "generating" && state.stale;
                      const isGen = (state.status === "pending" || state.status === "generating") && !isStale;
                      const isError = state.status === "error";
                      const isRecoverable = isError || isStale;
                      const clickable = (isUnlocked || isCompleted) && isReady;

                      return (
                        <motion.button
                          key={node.id}
                          whileHover={clickable ? { scale: 1.02 } : {}}
                          whileTap={clickable ? { scale: 0.98 } : {}}
                          onClick={() => { if (clickable) openNode(node); }}
                          className={`
                            relative flex items-center p-4 rounded-2xl border text-left transition-all
                            ${state.reviewDue && isCompleted ? "bg-amber-500/5 border-amber-500/40" : ""}
                            ${isCompleted && !state.reviewDue ? "bg-primary/10 border-primary/30" : ""}
                            ${isUnlocked && isReady ? "bg-zinc-900 border-zinc-700 hover:border-primary cursor-pointer shadow-lg" : ""}
                            ${isUnlocked && !isReady ? "bg-zinc-900 border-zinc-800" : ""}
                            ${uiStatus === "locked" ? "bg-zinc-900/50 border-zinc-800/50 opacity-60 cursor-not-allowed" : ""}
                          `}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs uppercase tracking-wider font-bold text-zinc-500">
                                {NODE_TYPE_LABELS[node.type] || node.type}
                              </span>
                              {isGen && (
                                <span className="text-xs font-bold text-amber-500/90 flex items-center gap-1">
                                  {state.status === "generating" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                                  {state.status === "generating" ? "grabando..." : "en cola"}
                                </span>
                              )}
                              {state.reviewDue && isCompleted && (
                                <span className="text-xs uppercase tracking-wider font-bold text-amber-500 flex items-center gap-1">
                                  <RefreshCw className="w-3 h-3" /> Repaso
                                </span>
                              )}
                            </div>
                            <h3 className={`font-semibold truncate ${isCompleted ? "text-primary-100" : "text-white"}`}>
                              {node.title}
                            </h3>
                            {state.bestStars !== null && (
                              <div className="mt-1.5 flex items-center gap-2">
                                <StarRow value={state.bestStars} />
                                <span className="text-xs text-zinc-600">{state.attemptCount} {state.attemptCount === 1 ? "intento" : "intentos"}</span>
                              </div>
                            )}
                            {isRecoverable && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); handleRetry(node.id); }}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-rose-400 hover:text-rose-300 cursor-pointer"
                              >
                                {retrying === node.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                {isStale ? "Se quedó atascada — Reintentar" : "Error al generar — Reintentar"}
                              </span>
                            )}
                            {route.isOwner && isReady && node.type !== "debate" && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setRegenNode(node); setRegenPrompt(""); }}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-primary cursor-pointer transition-colors"
                              >
                                <Wand2 className="w-3 h-3" /> Regenerar
                              </span>
                            )}
                          </div>

                          <div className="shrink-0 ml-4">
                            {isCompleted && state.reviewDue && <RefreshCw className="w-6 h-6 text-amber-500" />}
                            {isCompleted && !state.reviewDue && <CheckCircle2 className="w-6 h-6 text-primary" />}
                            {isUnlocked && isReady && <Play className="w-6 h-6 text-white" />}
                            {isUnlocked && isGen && <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />}
                            {isUnlocked && isRecoverable && <AlertTriangle className="w-5 h-5 text-rose-500" />}
                            {uiStatus === "locked" && <Lock className="w-5 h-5 text-zinc-600" />}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Modal de regeneración guiada (solo dueño) */}
      <AnimatePresence>
        {regenNode && (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !regenBusy && setRegenNode(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Wand2 className="w-5 h-5 text-primary" /> Regenerar lección
                </h3>
                <button onClick={() => !regenBusy && setRegenNode(null)} className="text-zinc-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-zinc-500 mb-4">{regenNode.title}</p>

              <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold">
                ¿Cómo quieres que sea? (opcional)
              </label>
              <textarea
                value={regenPrompt}
                onChange={e => setRegenPrompt(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Ej: hazla más práctica, con ejemplos del mundo médico; usa un tono más serio..."
                className="w-full mt-1 mb-3 bg-zinc-950 border border-zinc-800 rounded-2xl p-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
              />

              <p className="text-xs text-amber-400/80 mb-4 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Reemplaza el contenido y el audio actuales de esta lección. Tarda 1-2 minutos.
              </p>

              <button
                onClick={handleRegenerate}
                disabled={regenBusy}
                className="w-full py-3.5 rounded-2xl font-bold bg-primary text-white hover:bg-primary-hover transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {regenBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                Regenerar con IA
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default function KnowledgeTreePage() {
  return (
    <Suspense fallback={<TreeLoading />}>
      <KnowledgeTree />
    </Suspense>
  );
}
