"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Pause, Headphones, Zap, RefreshCw, Check, PartyPopper } from "lucide-react";
import type { AudioIntroData } from "@/lib/types";

interface Props {
  nodeTitle: string;
  audioBlob: Blob;
  intro: AudioIntroData;
  onFinish: (correctCount: number) => void;
  onExit: () => void;
}

const QUESTION_LIFETIME = 7; // segundos que vive cada pregunta
const PASS_RATIO = 0.7; // fracción de aciertos necesaria para avanzar (8 de 11)

type QuestionResult = "correct" | "wrong" | "missed" | null;
type Phase = "start" | "playing" | "results";

const EQ_BARS = 28;

export default function AudioIntroGame({ nodeTitle, audioBlob, intro, onFinish, onExit }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);

  const [phase, setPhase] = useState<Phase>("start");
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [results, setResults] = useState<QuestionResult[]>(() => intro.questions.map(() => null));
  // Respuesta recién tocada: se muestra el feedback un instante antes de que la tarjeta salga
  const [justAnswered, setJustAnswered] = useState<{ index: number; choice: number } | null>(null);

  const audioUrl = useMemo(() => URL.createObjectURL(audioBlob), [audioBlob]);
  useEffect(() => () => URL.revokeObjectURL(audioUrl), [audioUrl]);

  const totalQuestions = intro.questions.length;
  const passCount = Math.ceil(totalQuestions * PASS_RATIO);
  const correctCount = results.filter(r => r === "correct").length;

  // Reloj del juego anclado al audio: pausar el audio congela preguntas y contadores
  useEffect(() => {
    if (phase !== "playing") return;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const t = audio.currentTime;
        setCurrentTime(t);
        // Expirar preguntas no respondidas
        setResults(prev => {
          let changed = false;
          const next = [...prev];
          intro.questions.forEach((q, i) => {
            if (next[i] === null && t >= q.atSeconds + QUESTION_LIFETIME) {
              next[i] = "missed";
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, intro.questions]);

  const activeIndex = intro.questions.findIndex(
    (q, i) =>
      results[i] === null &&
      currentTime >= q.atSeconds &&
      currentTime < q.atSeconds + QUESTION_LIFETIME
  );
  const activeQuestion = activeIndex >= 0 ? intro.questions[activeIndex] : null;
  const showingAnswered = justAnswered !== null ? intro.questions[justAnswered.index] : null;

  const handleStart = () => {
    setPhase("playing");
    setIsPaused(false);
    audioRef.current?.play();
  };

  const togglePause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setIsPaused(false);
    } else {
      audio.pause();
      setIsPaused(true);
    }
  };

  const handleAnswer = (choice: number) => {
    if (activeIndex < 0 || justAnswered) return;
    const correct = choice === intro.questions[activeIndex].correctIndex;
    setJustAnswered({ index: activeIndex, choice });
    setResults(prev => {
      const next = [...prev];
      next[activeIndex] = correct ? "correct" : "wrong";
      return next;
    });
    setTimeout(() => setJustAnswered(null), 900);
  };

  const handleEnded = useCallback(() => {
    // Las preguntas aún abiertas al terminar cuentan como perdidas
    setResults(prev => prev.map(r => (r === null ? "missed" : r)));
    setPhase("results");
  }, []);

  const handleRetry = () => {
    const audio = audioRef.current;
    setResults(intro.questions.map(() => null));
    setJustAnswered(null);
    setCurrentTime(0);
    setPhase("playing");
    setIsPaused(false);
    if (audio) {
      audio.currentTime = 0;
      audio.play();
    }
  };

  const progress = intro.durationSeconds > 0 ? (currentTime / intro.durationSeconds) * 100 : 0;
  const passed = correctCount >= passCount;

  // Pregunta a renderizar (la activa, o la recién respondida durante su feedback)
  const cardIndex = justAnswered ? justAnswered.index : activeIndex;
  const cardQuestion = justAnswered ? showingAnswered : activeQuestion;
  const cardTimeLeft = cardQuestion
    ? Math.max(0, intro.questions[cardIndex].atSeconds + QUESTION_LIFETIME - currentTime)
    : 0;

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col overflow-hidden">
      <audio ref={audioRef} src={audioUrl} onEnded={handleEnded} preload="auto" />

      {/* Header */}
      <header className="flex items-center justify-between p-4 md:p-6 max-w-2xl w-full mx-auto">
        <button onClick={onExit} className="text-zinc-500 hover:text-white transition-colors">
          <X className="w-6 h-6" />
        </button>
        {/* Marcador: 6 puntos */}
        <div className="flex gap-2">
          {results.map((r, i) => (
            <motion.div
              key={i}
              animate={r !== null ? { scale: [1, 1.4, 1] } : {}}
              className={`w-3.5 h-3.5 rounded-full border ${
                r === "correct" ? "bg-emerald-500 border-emerald-400" :
                r === "wrong" ? "bg-rose-500 border-rose-400" :
                r === "missed" ? "bg-zinc-600 border-zinc-500" :
                "bg-zinc-900 border-zinc-700"
              }`}
            />
          ))}
        </div>
        <div className="w-6" />
      </header>

      {/* ── Pantalla de inicio ── */}
      {phase === "start" && (
        <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 14 }}
            className="w-28 h-28 bg-primary/10 border border-primary/30 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-primary/20"
          >
            <Headphones className="w-14 h-14 text-primary" />
          </motion.div>
          <h1 className="text-3xl font-bold mb-2">Modo Podcast</h1>
          <p className="text-zinc-400 mb-8">{nodeTitle}</p>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-left space-y-3 mb-8 w-full">
            <div className="flex items-center gap-3 text-sm text-zinc-300">
              <Headphones className="w-4 h-4 text-primary shrink-0" />
              Escucha el contexto completo (~3 min)
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-300">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              {totalQuestions} preguntas relámpago sobre lo que vas oyendo
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-300">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              Acierta {passCount} para avanzar · 7 segundos por pregunta
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleStart}
            className="w-24 h-24 rounded-full bg-primary text-white flex items-center justify-center shadow-2xl shadow-primary/40 hover:bg-primary-hover transition-colors"
          >
            <Play className="w-10 h-10 ml-1 fill-current" />
          </motion.button>
        </div>
      )}

      {/* ── Reproducción + juego ── */}
      {phase === "playing" && (
        <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6">
          <div className="text-center mb-2">
            <span className="uppercase tracking-widest text-xs font-bold text-zinc-500">
              {nodeTitle}
            </span>
          </div>

          {/* Ecualizador */}
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-1.5 h-40">
              {Array.from({ length: EQ_BARS }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-2 rounded-full bg-gradient-to-t from-primary to-accent"
                  animate={
                    isPaused
                      ? { height: 8 }
                      : { height: [8, 12 + ((i * 37) % 90), 20 + ((i * 53) % 60), 8 + ((i * 23) % 100), 8] }
                  }
                  transition={
                    isPaused
                      ? { duration: 0.3 }
                      : { duration: 1.2 + (i % 5) * 0.18, repeat: Infinity, ease: "easeInOut" }
                  }
                />
              ))}
            </div>
          </div>

          {/* Tarjeta de pregunta relámpago */}
          <div className="h-64 flex items-end">
            <AnimatePresence mode="wait">
              {cardQuestion && cardIndex >= 0 && (
                <motion.div
                  key={cardIndex}
                  initial={{ opacity: 0, y: 80, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -60, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 300, damping: 22 }}
                  className="w-full bg-zinc-900 border-2 border-amber-500/50 rounded-3xl p-5 shadow-2xl shadow-amber-500/10 relative overflow-hidden"
                >
                  {/* Cuenta regresiva ligada al audio (pausa = congelado) */}
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-zinc-800">
                    <div
                      className={`h-full transition-none ${cardTimeLeft < 2.5 ? "bg-rose-500" : "bg-amber-500"}`}
                      style={{ width: `${(cardTimeLeft / QUESTION_LIFETIME) * 100}%` }}
                    />
                  </div>

                  <div className="flex items-center gap-2 mb-3 mt-1">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="uppercase tracking-widest text-xs font-bold text-amber-400">
                      ¡Atención!
                    </span>
                  </div>
                  <h3 className="text-xl font-bold mb-4">{cardQuestion.question}</h3>

                  <div className="grid grid-cols-2 gap-3">
                    {cardQuestion.options.map((opt, i) => {
                      let cls = "bg-zinc-800 border-zinc-700 text-white hover:border-amber-500 hover:bg-amber-500/10";
                      if (justAnswered && justAnswered.index === cardIndex) {
                        const correct = intro.questions[cardIndex].correctIndex;
                        if (i === correct) cls = "bg-emerald-500/20 border-emerald-500 text-emerald-300";
                        else if (i === justAnswered.choice) cls = "bg-rose-500/20 border-rose-500 text-rose-300";
                        else cls = "bg-zinc-800 border-zinc-700 text-zinc-500 opacity-50";
                      }
                      return (
                        <motion.button
                          key={i}
                          whileTap={{ scale: 0.94 }}
                          disabled={!!justAnswered}
                          onClick={() => handleAnswer(i)}
                          className={`p-4 rounded-2xl border-2 font-bold text-lg transition-all ${cls}`}
                        >
                          {opt}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Controles del audio */}
          <div className="mt-6 flex items-center gap-4">
            <button
              onClick={togglePause}
              className="w-12 h-12 shrink-0 rounded-full bg-zinc-900 border border-zinc-700 text-white flex items-center justify-center hover:border-primary transition-colors"
            >
              {isPaused ? <Play className="w-5 h-5 ml-0.5 fill-current" /> : <Pause className="w-5 h-5 fill-current" />}
            </button>
            <div className="flex-1 h-2 bg-zinc-900 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-zinc-500 tabular-nums shrink-0">
              {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, "0")}
            </span>
          </div>
        </div>
      )}

      {/* ── Resultados ── */}
      {phase === "results" && (
        <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 14 }}
            className={`w-24 h-24 rounded-3xl border flex items-center justify-center mb-6 ${
              passed
                ? "bg-emerald-500/10 border-emerald-500/40 shadow-2xl shadow-emerald-500/20"
                : "bg-rose-500/10 border-rose-500/40"
            }`}
          >
            {passed ? <PartyPopper className="w-12 h-12 text-emerald-400" /> : <Headphones className="w-12 h-12 text-rose-400" />}
          </motion.div>

          <h2 className="text-3xl font-bold mb-2">
            {passed ? "¡Atención comprobada!" : "Tu mente se distrajo 😅"}
          </h2>
          <p className="text-zinc-400 mb-6">
            Acertaste <span className={`font-bold ${passed ? "text-emerald-400" : "text-rose-400"}`}>{correctCount}</span> de {totalQuestions}
            {passed ? " · +15 XP" : ` · necesitas ${passCount}`}
          </p>

          <div className="flex gap-2 mb-10">
            {results.map((r, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full ${
                  r === "correct" ? "bg-emerald-500" : r === "wrong" ? "bg-rose-500" : "bg-zinc-600"
                }`}
              />
            ))}
          </div>

          {passed ? (
            <button
              onClick={() => onFinish(correctCount)}
              className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
            >
              Empezar la lección
            </button>
          ) : (
            <button
              onClick={handleRetry}
              className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-rose-500 text-white hover:bg-rose-400 transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-5 h-5" /> Repetir el podcast
            </button>
          )}
        </div>
      )}
    </main>
  );
}
