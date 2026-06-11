"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, Crosshair, Ear, ListChecks, PartyPopper, Radar } from "lucide-react";
import type { SpyData } from "@/lib/types";
import { EqBars, AudioControls, GameHeader, GameBriefing, GameResults } from "./shared";

interface Props {
  nodeTitle: string;
  audioBlob: Blob;
  data: SpyData;
  durationSeconds: number;
  onFinish: (correct: number, total: number) => void;
  onExit: () => void;
}

type Phase = "briefing" | "playing" | "questions" | "results";

/**
 * MECÁNICA 1 — MISIÓN DE ESPÍA
 * Las misiones se revelan ANTES del audio; el agente escucha con objetivos
 * concretos y responde el interrogatorio al final.
 */
export default function SpyGame({ nodeTitle, audioBlob, data, durationSeconds, onFinish, onExit }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>("briefing");
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Array<boolean | null>>(() => data.misiones.map(() => null));
  const [justPicked, setJustPicked] = useState<number | null>(null);

  const audioUrl = useMemo(() => URL.createObjectURL(audioBlob), [audioBlob]);
  useEffect(() => () => URL.revokeObjectURL(audioUrl), [audioUrl]);

  const total = data.misiones.length;
  // Con 2 misiones hay que acertar ambas; con 3, se permite fallar una.
  const passCount = total <= 2 ? total : total - 1;
  const correctCount = answers.filter(a => a === true).length;
  const passed = correctCount >= passCount;

  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      const a = audioRef.current;
      if (a) setCurrentTime(a.currentTime);
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  const startPlaying = () => {
    setPhase("playing");
    setIsPaused(false);
    const a = audioRef.current;
    if (a) {
      a.currentTime = 0;
      a.play();
    }
  };

  const togglePause = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setIsPaused(false); }
    else { a.pause(); setIsPaused(true); }
  };

  const handleAnswer = (choice: number) => {
    if (justPicked !== null) return;
    setJustPicked(choice);
    const correct = choice === data.misiones[questionIndex].correctIndex;
    setAnswers(prev => {
      const next = [...prev];
      next[questionIndex] = correct;
      return next;
    });
    setTimeout(() => {
      setJustPicked(null);
      if (questionIndex < total - 1) setQuestionIndex(i => i + 1);
      else setPhase("results");
    }, 1100);
  };

  const handleRetry = () => {
    setAnswers(data.misiones.map(() => null));
    setQuestionIndex(0);
    setJustPicked(null);
    setCurrentTime(0);
    startPlaying();
  };

  const dots = answers.map(a => (a === null ? "pending" : a ? "correct" : "wrong") as "pending" | "correct" | "wrong");

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col overflow-hidden">
      <audio ref={audioRef} src={audioUrl} onEnded={() => setPhase("questions")} preload="auto" />
      <GameHeader onExit={onExit} dots={phase !== "briefing" ? dots : undefined} />

      {phase === "briefing" && (
        <GameBriefing
          icon={<Eye className="w-12 h-12 text-cyan-400" />}
          color="bg-cyan-500/10 border-cyan-500/30 shadow-cyan-500/20"
          title="Misión de Espía"
          subtitle={nodeTitle}
          howTo={[
            { icon: <Crosshair className="w-4 h-4 text-cyan-400" />, text: <>Memoriza tus <b>{total} misiones</b> de escucha (abajo).</> },
            { icon: <Ear className="w-4 h-4 text-primary" />, text: <>Escucha el podcast completo cazando esos detalles: <b>no se repiten</b>.</> },
            { icon: <ListChecks className="w-4 h-4 text-emerald-400" />, text: <>Al final responderás una pregunta por misión. Necesitas <b>{passCount} de {total}</b>.</> },
          ]}
          extra={
            <div className="w-full space-y-2 mb-4">
              {data.misiones.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.15 }}
                  className="flex items-start gap-3 bg-cyan-500/5 border border-cyan-500/30 rounded-2xl p-4 text-left"
                >
                  <span className="w-7 h-7 shrink-0 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <p className="text-sm text-cyan-100 leading-snug">{m.instruccion}</p>
                </motion.div>
              ))}
            </div>
          }
          onStart={startPlaying}
          startLabel="Misión"
        />
      )}

      {phase === "playing" && (
        <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6">
          <div className="text-center mb-2">
            <span className="uppercase tracking-widest text-xs font-bold text-cyan-400 flex items-center justify-center gap-2">
              <Radar className="w-4 h-4 animate-pulse" /> Misión en curso
            </span>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <EqBars paused={isPaused} />
          </div>

          {/* Recordatorio de misiones durante la escucha */}
          <div className="space-y-2">
            {data.misiones.map((m, i) => (
              <div key={i} className="flex items-center gap-3 bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5">
                <Crosshair className="w-4 h-4 text-cyan-400 shrink-0" />
                <p className="text-xs text-zinc-300 leading-snug">{m.instruccion}</p>
              </div>
            ))}
          </div>

          <AudioControls
            currentTime={currentTime}
            duration={durationSeconds}
            isPaused={isPaused}
            onTogglePause={togglePause}
          />
        </div>
      )}

      {phase === "questions" && (
        <div className="flex-1 flex flex-col max-w-xl w-full mx-auto p-6 justify-center">
          <div className="text-center mb-6">
            <span className="uppercase tracking-widest text-xs font-bold text-cyan-400">
              Interrogatorio · Misión {questionIndex + 1} de {total}
            </span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={questionIndex}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-zinc-900 border-2 border-cyan-500/40 rounded-3xl p-6"
            >
              <p className="text-xs text-cyan-300/70 mb-2 flex items-center gap-2">
                <Crosshair className="w-3.5 h-3.5" /> {data.misiones[questionIndex].instruccion}
              </p>
              <h3 className="text-xl font-bold mb-5">{data.misiones[questionIndex].pregunta}</h3>

              <div className="space-y-3">
                {data.misiones[questionIndex].options.map((opt, i) => {
                  let cls = "bg-zinc-800 border-zinc-700 text-white hover:border-cyan-500 hover:bg-cyan-500/10";
                  if (justPicked !== null) {
                    const correct = data.misiones[questionIndex].correctIndex;
                    if (i === correct) cls = "bg-emerald-500/20 border-emerald-500 text-emerald-300";
                    else if (i === justPicked) cls = "bg-rose-500/20 border-rose-500 text-rose-300";
                    else cls = "bg-zinc-800 border-zinc-700 text-zinc-500 opacity-50";
                  }
                  return (
                    <motion.button
                      key={i}
                      whileTap={{ scale: 0.96 }}
                      disabled={justPicked !== null}
                      onClick={() => handleAnswer(i)}
                      className={`w-full p-4 rounded-2xl border-2 font-bold text-left transition-all ${cls}`}
                    >
                      {opt}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {phase === "results" && (
        <GameResults
          passed={passed}
          title="Misión de Espía"
          passedTitle="¡Misión cumplida, agente!"
          failedTitle="La misión falló..."
          icon={passed ? <PartyPopper className="w-12 h-12 text-emerald-400" /> : <Eye className="w-12 h-12 text-rose-400" />}
          detail={
            <p>
              Resolviste <span className={`font-bold ${passed ? "text-emerald-400" : "text-rose-400"}`}>{correctCount}</span> de {total} misiones
              {passed ? "" : ` · necesitas ${passCount}`}
            </p>
          }
          onContinue={() => onFinish(correctCount, total)}
          onRetry={handleRetry}
        />
      )}
    </main>
  );
}
