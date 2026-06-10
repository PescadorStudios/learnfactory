"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Lock, CheckCircle2, Star, Trophy, Loader2, Sparkles, Flame, RefreshCw } from "lucide-react";
import { generateStudyPack } from "../actions";
import type { Tree, TreeNode } from "@/lib/types";
import { getProgress, getMastery, getXp, getStreak, getReviewDueNodes, averageMastery } from "@/lib/gamification";

/** Aplica el progreso local (nodos completados) al árbol de la API */
function applyProgress(treeData: Tree, completedNodes: string[]) {
  if (!treeData?.levels) return treeData;

  // Recolectar TODOS los nodos en orden plano
  const allNodes: { levelIdx: number; nodeIdx: number; id: string }[] = [];
  treeData.levels.forEach((level, li) => {
    level.nodes.forEach((node, ni) => {
      allNodes.push({ levelIdx: li, nodeIdx: ni, id: node.id });
    });
  });

  // Marcar todos como locked primero
  for (const level of treeData.levels) {
    for (const node of level.nodes) {
      node.status = "locked";
    }
  }

  // Marcar los completados
  for (const nodeRef of allNodes) {
    if (completedNodes.includes(nodeRef.id)) {
      treeData.levels[nodeRef.levelIdx].nodes[nodeRef.nodeIdx].status = "completed";
    }
  }

  // Encontrar el primer nodo NO completado y desbloquearlo
  const firstLocked = allNodes.find(n => !completedNodes.includes(n.id));
  if (firstLocked) {
    treeData.levels[firstLocked.levelIdx].nodes[firstLocked.nodeIdx].status = "unlocked";
  }

  return treeData;
}

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
      <p className="text-zinc-400">Leyendo tus fuentes y construyendo la Síntesis Maestra...</p>
    </div>
  );
}

function KnowledgeTree() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic") || "Tema Desconocido";
  const sourcesStr = searchParams.get("sources") || "";
  const completedNode = searchParams.get("completedNode") || "";
  const gainedXp = parseInt(searchParams.get("xp") || "0", 10) || 0;
  const [treeData, setTreeData] = useState<Tree | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);
  const [reviewDue, setReviewDue] = useState<string[]>([]);
  const [masteryByNode, setMasteryByNode] = useState<Record<string, number | null>>({});
  const [totalXp, setTotalXp] = useState(0);
  const [streakDays, setStreakDays] = useState(0);

  useEffect(() => {
    async function loadTree() {
      setLoading(true);

      // Leer progreso de localStorage
      const progress = getProgress(topic);
      const completedIds = progress.map(p => p.id);

      // Intentar cargar árbol Y síntesis de cache (si falta alguno, regenerar ambos)
      const treeKey = `learnfactory_tree_${topic}`;
      const synthesisKey = `learnfactory_synthesis_${topic}`;
      let tree: Tree | null = null;

      try {
        const cachedTree = localStorage.getItem(treeKey);
        const cachedSynthesis = localStorage.getItem(synthesisKey);
        if (cachedTree && cachedSynthesis) {
          tree = JSON.parse(cachedTree);
        }
      } catch {}

      if (!tree) {
        const pack = await generateStudyPack(topic, sourcesStr);
        tree = pack.tree;
        localStorage.setItem(treeKey, JSON.stringify(pack.tree));
        localStorage.setItem(synthesisKey, JSON.stringify(pack.sintesis));
      }

      // Aplicar el progreso local al árbol
      const withProgress = applyProgress(JSON.parse(JSON.stringify(tree)), completedIds);
      setTreeData(withProgress);

      // Gamificación: XP, racha, maestría por nodo y repasos pendientes
      const mastery = getMastery(topic);
      setTotalXp(getXp(topic).total);
      setStreakDays(getStreak().current);
      setReviewDue(getReviewDueNodes(withProgress, progress, mastery));

      const byNode: Record<string, number | null> = {};
      for (const level of withProgress.levels) {
        for (const node of level.nodes) {
          byNode[node.id] = averageMastery(mastery, node.conceptIds || []);
        }
      }
      setMasteryByNode(byNode);

      setLoading(false);

      // Si venimos de completar un nodo, mostrar celebración
      if (completedNode) {
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 3000);
      }
    }
    loadTree();
  }, [topic, sourcesStr, completedNode]);

  if (loading || !treeData) {
    return <TreeLoading />;
  }

  const openNode = (node: TreeNode) => {
    const isReviewLaunch = node.status === "completed" && reviewDue.includes(node.id);
    const params = new URLSearchParams({
      topic,
      node: node.id,
      title: node.title,
      type: isReviewLaunch ? "quiz" : node.type,
    });
    if (node.conceptIds?.length) params.set("concepts", node.conceptIds.join(","));
    if (isReviewLaunch) params.set("review", "1");
    router.push(`/lesson?${params.toString()}`);
  };

  // Contar progreso
  const allNodes = treeData.levels.flatMap(l => l.nodes);
  const completedCount = allNodes.filter(n => n.status === "completed").length;
  const totalNodes = allNodes.length;
  const progressPercent = totalNodes > 0 ? Math.round((completedCount / totalNodes) * 100) : 0;

  return (
    <main className="min-h-screen bg-zinc-950 p-6 md:p-12 relative overflow-y-auto">
      {/* Background Decor */}
      <div className="fixed top-0 inset-x-0 h-96 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />

      {/* Celebración al completar un nodo */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: -50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: -50 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-primary/90 backdrop-blur-md text-white px-8 py-4 rounded-2xl flex items-center gap-3 shadow-2xl shadow-primary/30"
          >
            <Sparkles className="w-6 h-6" />
            <span className="font-bold text-lg">
              ¡Completado!{gainedXp > 0 ? ` +${gainedXp} XP` : ""}
            </span>
            <Sparkles className="w-6 h-6" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-3xl mx-auto relative z-10 pt-10">
        <header className="mb-12 text-center">
          {/* Stats: XP y racha */}
          <div className="flex justify-center gap-3 mb-6">
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2">
              <Star className="w-4 h-4 text-amber-400 fill-current" />
              <span className="font-bold text-sm text-white">{totalXp} XP</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2">
              <Flame className={`w-4 h-4 ${streakDays > 0 ? "text-orange-500 fill-current" : "text-zinc-600"}`} />
              <span className="font-bold text-sm text-white">{streakDays} {streakDays === 1 ? "día" : "días"}</span>
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
            className="text-3xl md:text-5xl font-bold mb-4"
          >
            Ruta de <span className="text-primary">{topic}</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-zinc-400 mb-6"
          >
            Tu árbol de conocimiento personalizado generado por IA
          </motion.p>

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
          {treeData.levels.map((level, levelIndex) => (
            <motion.div
              key={level.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: levelIndex * 0.2 }}
              className="relative"
            >
              {/* Conector vertical para el mapa */}
              {levelIndex !== treeData.levels.length - 1 && (
                <div className="absolute left-8 top-24 bottom-[-3rem] w-0.5 bg-zinc-800" />
              )}

              <div className="flex items-start gap-6">
                <div className="w-16 h-16 shrink-0 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-center font-bold text-xl text-zinc-500 z-10 relative">
                  {level.id}
                </div>
                <div className="flex-1 pt-2">
                  <h2 className="text-2xl font-bold mb-1">{level.title}</h2>
                  <p className="text-zinc-500 text-sm mb-6">{level.description}</p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {level.nodes.map((node) => {
                      const isCompleted = node.status === "completed";
                      const isUnlocked = node.status === "unlocked";
                      const needsReview = isCompleted && reviewDue.includes(node.id);
                      const nodeMastery = masteryByNode[node.id];

                      return (
                        <motion.button
                          key={node.id}
                          whileHover={isUnlocked || isCompleted ? { scale: 1.02 } : {}}
                          whileTap={isUnlocked || isCompleted ? { scale: 0.98 } : {}}
                          onClick={() => {
                            if (isUnlocked || isCompleted) openNode(node);
                          }}
                          className={`
                            relative flex items-center p-4 rounded-2xl border text-left transition-all
                            ${needsReview ? "bg-amber-500/5 border-amber-500/40" : ""}
                            ${isCompleted && !needsReview ? "bg-primary/10 border-primary/30" : ""}
                            ${isUnlocked ? "bg-zinc-900 border-zinc-700 hover:border-primary cursor-pointer shadow-lg" : ""}
                            ${!isCompleted && !isUnlocked ? "bg-zinc-900/50 border-zinc-800/50 opacity-60 cursor-not-allowed" : ""}
                          `}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs uppercase tracking-wider font-bold text-zinc-500">
                                {NODE_TYPE_LABELS[node.type] || node.type}
                              </span>
                              {needsReview && (
                                <span className="text-xs uppercase tracking-wider font-bold text-amber-500 flex items-center gap-1">
                                  <RefreshCw className="w-3 h-3" /> Repaso
                                </span>
                              )}
                            </div>
                            <h3 className={`font-semibold ${isCompleted ? "text-primary-100" : "text-white"}`}>
                              {node.title}
                            </h3>
                            {/* Barra de maestría del nodo */}
                            {typeof nodeMastery === "number" && (
                              <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden max-w-[140px]">
                                <div
                                  className={`h-full rounded-full ${nodeMastery >= 80 ? "bg-emerald-500" : nodeMastery >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                                  style={{ width: `${nodeMastery}%` }}
                                />
                              </div>
                            )}
                          </div>

                          <div className="shrink-0 ml-4">
                            {needsReview && <RefreshCw className="w-6 h-6 text-amber-500" />}
                            {isCompleted && !needsReview && <CheckCircle2 className="w-6 h-6 text-primary" />}
                            {isUnlocked && <Play className="w-6 h-6 text-white" />}
                            {!isCompleted && !isUnlocked && <Lock className="w-5 h-5 text-zinc-600" />}
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
