"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle, Mic } from "lucide-react";
import type { AttemptInput, LessonData } from "@/lib/types";
import { useRequireAuth } from "@/lib/useAuth";
import { getLesson, saveAttempt } from "../routeActions";
import { getAudio, putAudio } from "@/lib/audioCache";
import MicroLesson from "./MicroLesson";
import DebateNode from "./DebateNode";
import QuizNode from "./QuizNode";
import BossExam from "./BossExam";

function LessonLoading({ text = "Cargando..." }: { text?: string }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white">
      <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
      <p className="text-zinc-400">{text}</p>
    </div>
  );
}

function LessonDispatcher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeId = searchParams.get("route") || "";
  const nodeId = searchParams.get("node") || "";

  const { token, loading: authLoading, session } = useRequireAuth();
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const fetchedAudioFor = useRef<string | null>(null);

  const goToTree = useCallback(() => {
    router.push(`/tree?route=${routeId}`);
  }, [router, routeId]);

  const load = useCallback(async () => {
    if (!token || !routeId || !nodeId) return;
    const data = await getLesson(token, routeId, nodeId);
    if (!data) {
      setNotFound(true);
      return;
    }
    setLesson(data);
  }, [token, routeId, nodeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling mientras la lección se esté generando
  useEffect(() => {
    if (!lesson || lesson.status === "ready" || lesson.status === "error") return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [lesson, load]);

  // Descargar el audio (IndexedDB primero, luego Storage)
  useEffect(() => {
    if (!lesson || lesson.status !== "ready" || !lesson.audioIntro || !lesson.audioUrl) return;
    const audioKey = `audio_${routeId}_${nodeId}`;
    if (fetchedAudioFor.current === audioKey) return;
    fetchedAudioFor.current = audioKey;

    (async () => {
      setAudioLoading(true);
      let blob = await getAudio(audioKey);
      if (!blob) {
        try {
          const res = await fetch(lesson.audioUrl!);
          if (res.ok) {
            blob = await res.blob();
            await putAudio(audioKey, blob);
          }
        } catch {
          blob = null;
        }
      }
      setAudioBlob(blob);
      setAudioLoading(false);
    })();
  }, [lesson, routeId, nodeId]);

  const handleComplete = async (input: AttemptInput) => {
    if (!token) return;
    setSaving(true);
    const result = await saveAttempt(token, routeId, nodeId, input);
    const params = new URLSearchParams({ route: routeId });
    if (input.passed) {
      params.set("completedNode", nodeId);
      params.set("xp", String(result.xpGained));
      params.set("stars", String(input.stars));
      if (result.newBest) params.set("best", "1");
    }
    router.push(`/tree?${params.toString()}`);
  };

  if (authLoading || !session) return <LessonLoading />;

  if (notFound) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Lección no encontrada</h2>
        <button onClick={goToTree} className="mt-4 px-8 py-4 rounded-2xl font-bold bg-primary text-white hover:bg-primary-hover transition-all">
          Volver al árbol
        </button>
      </div>
    );
  }

  if (!lesson) return <LessonLoading />;

  if (saving) return <LessonLoading text="Guardando tu resultado..." />;

  // Lección aún cocinándose en el background
  if (lesson.status === "pending" || lesson.status === "generating") {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center">
        <div className="w-20 h-20 bg-primary/10 border border-primary/30 rounded-3xl flex items-center justify-center mb-6">
          <Mic className="w-10 h-10 text-primary animate-pulse" />
        </div>
        <h2 className="text-2xl font-bold mb-2">🎙️ Tu podcast se está grabando...</h2>
        <p className="text-zinc-400 max-w-md">
          Esta lección se está generando con su narración de voz. Suele tardar 1-2 minutos; la página se actualizará sola.
        </p>
        <button onClick={goToTree} className="mt-8 text-zinc-500 hover:text-white transition-colors text-sm">
          Volver al árbol mientras tanto
        </button>
      </div>
    );
  }

  if (lesson.status === "error") {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-rose-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Esta lección falló al generarse</h2>
        <p className="text-zinc-400 mb-6 max-w-md">Vuelve al árbol y usa &quot;Reintentar&quot; en la lección.</p>
        <button onClick={goToTree} className="px-8 py-4 rounded-2xl font-bold bg-primary text-white hover:bg-primary-hover transition-all">
          Volver al árbol
        </button>
      </div>
    );
  }

  // Esperar el audio si la lección lo tiene
  if (lesson.audioIntro && lesson.audioUrl && audioLoading) {
    return <LessonLoading text="Descargando el podcast de la lección..." />;
  }

  const common = {
    routeId,
    token: token!,
    lesson,
    onComplete: handleComplete,
    onExit: goToTree,
  };

  if (lesson.nodeType === "quiz") return <QuizNode {...common} />;
  if (lesson.nodeType === "debate") return <DebateNode {...common} />;
  if (lesson.nodeType === "boss") return <BossExam {...common} />;
  return <MicroLesson {...common} audioBlob={audioBlob} />;
}

export default function LessonPage() {
  return (
    <Suspense fallback={<LessonLoading />}>
      <LessonDispatcher />
    </Suspense>
  );
}
