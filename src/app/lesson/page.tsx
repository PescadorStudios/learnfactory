"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import type { NodeResult, NodeType, Sintesis } from "@/lib/types";
import { completeNode } from "@/lib/gamification";
import MicroLesson from "./MicroLesson";
import DebateNode from "./DebateNode";
import QuizNode from "./QuizNode";
import BossExam from "./BossExam";

function LessonLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white">
      <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
      <p className="text-zinc-400">Cargando...</p>
    </div>
  );
}

function LessonDispatcher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic") || "Tema";
  const nodeId = searchParams.get("node") || "1a";
  const nodeTitle = searchParams.get("title") || `Concepto ${nodeId}`;
  const nodeType = (searchParams.get("type") || "theory") as NodeType;
  const conceptIds = (searchParams.get("concepts") || "").split(",").filter(Boolean);
  const isReview = searchParams.get("review") === "1";

  const [sintesis, setSintesis] = useState<Sintesis | null>(null);
  const [synthesisMissing, setSynthesisMissing] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`learnfactory_synthesis_${topic}`);
      if (raw) {
        setSintesis(JSON.parse(raw));
        return;
      }
    } catch {}
    setSynthesisMissing(true);
  }, [topic]);

  const goToTree = () => router.push(`/tree?topic=${encodeURIComponent(topic)}`);

  const handleComplete = (result: NodeResult) => {
    const gained = completeNode(topic, nodeId, result);
    if (result.passed === false) {
      // Boss no superado: volver al árbol sin celebración
      goToTree();
      return;
    }
    const params = new URLSearchParams({ topic, completedNode: nodeId, xp: String(gained) });
    router.push(`/tree?${params.toString()}`);
  };

  // La síntesis es la fuente de verdad de todas las experiencias: sin ella, volver
  // al árbol para que se regenere (caches de versiones anteriores no la tienen)
  if (synthesisMissing) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Falta la Síntesis Maestra</h2>
        <p className="text-zinc-400 mb-6 max-w-md">
          Este curso fue creado con una versión anterior. Vuelve al árbol para regenerarlo a partir de tus fuentes.
        </p>
        <button
          onClick={() => {
            localStorage.removeItem(`learnfactory_tree_${topic}`);
            goToTree();
          }}
          className="px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
        >
          Regenerar curso
        </button>
      </div>
    );
  }

  if (!sintesis) {
    return <LessonLoading />;
  }

  const common = { topic, nodeId, nodeTitle, sintesis, conceptIds, onComplete: handleComplete, onExit: goToTree };

  if (nodeType === "quiz") {
    return <QuizNode {...common} isReview={isReview} />;
  }
  if (nodeType === "debate") {
    return <DebateNode {...common} />;
  }
  if (nodeType === "boss") {
    return <BossExam {...common} />;
  }
  return <MicroLesson {...common} nodeType={nodeType} />;
}

export default function LessonPage() {
  return (
    <Suspense fallback={<LessonLoading />}>
      <LessonDispatcher />
    </Suspense>
  );
}
