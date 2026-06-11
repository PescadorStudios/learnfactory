"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plane, Ear, Timer, MessageCircleQuestion, PartyPopper, Mic } from "lucide-react";
import type { CopilotData } from "@/lib/types";
import { EqBars, AudioControls, GameHeader, GameBriefing, GameResults } from "./shared";

interface Props {
  nodeTitle: string;
  audioBlob: Blob;
  data: CopilotData;
  durationSeconds: number;
  onFinish: (correct: number, total: number) => void;
  onExit: () => void;
}

type Phase = "briefing" | "playing" | "results";

const DECISION_SECONDS = 5;
const CORRECTION_MS = 3800;

/**
 * MECÁNICA 3 — CO-PILOTO NARRATIVO
 * El narrador duda en 6 momentos y pausa: el oyente decide en 5 segundos.
 * Si acierta, el vuelo sigue fluido; si falla, el narrador corrige y retoma.
 */
export default function CopilotGame({ nodeTitle, audioBlob, data, durationSeconds, onFinish, onExit }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("briefing");
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [answers, setAnswers] = useState<Array<boolean | null>>(() => data.checkpoints.map(() => null));
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DECISION_SECONDS);
  const [feedback, setFeedback] = useState<"correct" | null>(null);
  const [correction, setCorrection] = useState<string | null>(null);

  const audioUrl = useMemo(() => URL.createObjectURL(audioBlob), [audioBlob]);
  useEffect(() => () => URL.revokeObjectURL(audioUrl), [audioUrl]);

  const total = data.checkpoints.length;
  const passCount = Math.ceil(total * 0.66); // 6 → 4
  const correctCount = answers.filter(a => a === true).length;
  const passed = correctCount >= passCount;

  // refs espejo para el loop rAF
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const activeRef = useRef(activeIdx);
  activeRef.current = activeIdx;
  const correctionRef = useRef(correction);
  correctionRef.current = correction;
  const deadlineRef = useRef(deadline);
  deadlineRef.current = deadline;

  const resumeAudio = () => {
    setFeedback(null);
    setCorrection(null);
    setActiveIdx(null);
    audioRef.current?.play();
  };

  const failCheckpoint = (idx: number) => {
    setAnswers(prev => {
      const next = [...prev];
      next[idx] = false;
      return next;
    });
    setActiveIdx(null);
    setCorrection(data.checkpoints[idx].correccion);
    setTimeout(() => {
      setCorrection(null);
      audioRef.current?.play();
    }, CORRECTION_MS);
  };

  // Loop: sincroniza tiempo, dispara checkpoints y cuenta los 5 segundos
  useEffect(() => {
    if (phase !== "playing") return;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const t = a.currentTime;
        setCurrentTime(t);

        // ¿Toca pausar en un checkpoint?
        if (activeRef.current === null && !correctionRef.current && !a.paused) {
          const idx = data.checkpoints.findIndex(
            (cp, i) => answersRef.current[i] === null && t >= Math.min(cp.atSeconds, Math.max(0, durationSeconds - 1))
          );
          if (idx >= 0) {
            a.pause();
            setActiveIdx(idx);
            const dl = Date.now() + DECISION_SECONDS * 1000;
            setDeadline(dl);
            setTimeLeft(DECISION_SECONDS);
          }
        }

        // Cuenta regresiva del checkpoint activo
        if (activeRef.current !== null) {
          const left = (deadlineRef.current - Date.now()) / 1000;
          setTimeLeft(Math.max(0, left));
          if (left <= 0) failCheckpoint(activeRef.current);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (activeIdx !== null || correction) return; // durante una decisión no se pausa
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setIsPaused(false); }
    else { a.pause(); setIsPaused(true); }
  };

  const handleChoice = (choice: number) => {
    if (activeIdx === null) return;
    const cp = data.checkpoints[activeIdx];
    if (choice === cp.correctIndex) {
      setAnswers(prev => {
        const next = [...prev];
        next[activeIdx] = true;
        return next;
      });
      setFeedback("correct");
      setTimeout(resumeAudio, 800);
    } else {
      failCheckpoint(activeIdx);
    }
  };

  const handleEnded = () => {
    // Checkpoints que nunca llegaron a dispararse cuentan como fallo
    setAnswers(prev => prev.map(a => (a === null ? false : a)));
    setPhase("results");
  };

  const handleRetry = () => {
    setAnswers(data.checkpoints.map(() => null));
    setActiveIdx(null);
    setCorrection(null);
    setFeedback(null);
    setCurrentTime(0);
    startPlaying();
  };

  const dots = answers.map(a => (a === null ? "pending" : a ? "correct" : "wrong") as "pending" | "correct" | "wrong");
  const activeCp = activeIdx !== null ? data.checkpoints[activeIdx] : null;

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col overflow-hidden">
      <audio ref={audioRef} src={audioUrl} onEnded={handleEnded} preload="auto" />
      <GameHeader onExit={onExit} dots={phase !== "briefing" ? dots : undefined} />

      {phase === "briefing" && (
        <GameBriefing
          icon={<Plane className="w-12 h-12 text-violet-400" />}
          color="bg-violet-500/10 border-violet-500/30 shadow-violet-500/20"
          title="Co-Piloto Narrativo"
          subtitle={nodeTitle}
          howTo={[
            { icon: <Ear className="w-4 h-4 text-primary" />, text: <>El narrador te lleva de viaje por el tema... pero <b>dudará {total} veces</b> en voz alta.</> },
            { icon: <MessageCircleQuestion className="w-4 h-4 text-violet-400" />, text: <>En cada duda el audio se pausa y aparecen <b>2 opciones</b>: tú decides el rumbo.</> },
            { icon: <Timer className="w-4 h-4 text-amber-400" />, text: <>Tienes <b>{DECISION_SECONDS} segundos</b>. Las opciones solas no dicen nada: hay que haber escuchado.</> },
            { icon: <Mic className="w-4 h-4 text-emerald-400" />, text: <>Aciertas → el vuelo sigue fluido. Fallas → el narrador corrige y retoma. Necesitas <b>{passCount} de {total}</b>.</> },
          ]}
          onStart={startPlaying}
          startLabel="Despegar"
        />
      )}

      {phase === "playing" && (
        <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6">
          <div className="text-center mb-2">
            <span className="uppercase tracking-widest text-xs font-bold text-violet-400">
              Co-pilotando: {nodeTitle}
            </span>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <EqBars paused={isPaused || activeIdx !== null || Boolean(correction)} />
          </div>

          {/* Zona de decisión / corrección */}
          <div className="h-60 flex items-end">
            <AnimatePresence mode="wait">
              {activeCp && (
                <motion.div
                  key={`cp-${activeIdx}`}
                  initial={{ opacity: 0, y: 60, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -40, scale: 0.94 }}
                  transition={{ type: "spring", stiffness: 300, damping: 24 }}
                  className={`w-full rounded-3xl border-2 p-5 relative overflow-hidden ${
                    feedback === "correct" ? "bg-emerald-500/10 border-emerald-500" : "bg-zinc-900 border-violet-500/60"
                  }`}
                >
                  {/* Cuenta regresiva de 5 s */}
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-zinc-800">
                    <div
                      className={`h-full ${timeLeft < 2 ? "bg-rose-500" : "bg-violet-500"}`}
                      style={{ width: `${(timeLeft / DECISION_SECONDS) * 100}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between mb-3 mt-1">
                    <span className="uppercase tracking-widest text-xs font-bold text-violet-400 flex items-center gap-2">
                      <MessageCircleQuestion className="w-4 h-4" /> El narrador duda... ¡decide tú!
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${timeLeft < 2 ? "text-rose-400" : "text-zinc-400"}`}>
                      {Math.ceil(timeLeft)}s
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {activeCp.options.map((opt, i) => (
                      <motion.button
                        key={i}
                        whileTap={{ scale: 0.94 }}
                        disabled={feedback !== null}
                        onClick={() => handleChoice(i)}
                        className={`p-5 rounded-2xl border-2 font-bold text-lg transition-all ${
                          feedback === "correct" && i === activeCp.correctIndex
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                            : "bg-zinc-800 border-zinc-700 text-white hover:border-violet-500 hover:bg-violet-500/10"
                        }`}
                      >
                        {opt}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}

              {correction && (
                <motion.div
                  key="correction"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -30 }}
                  className="w-full bg-zinc-900 border-2 border-amber-500/50 rounded-3xl p-5 flex items-start gap-4"
                >
                  <div className="w-10 h-10 shrink-0 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                    <Mic className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="uppercase tracking-widest text-[11px] font-bold text-amber-400 mb-1">El narrador corrige</p>
                    <p className="text-zinc-200 leading-snug">{correction}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AudioControls
            currentTime={currentTime}
            duration={durationSeconds}
            isPaused={isPaused}
            onTogglePause={togglePause}
            disabled={activeIdx !== null || Boolean(correction)}
          />
        </div>
      )}

      {phase === "results" && (
        <GameResults
          passed={passed}
          title="Co-Piloto Narrativo"
          passedTitle="¡Aterrizaje perfecto!"
          failedTitle="Turbulencias en el vuelo..."
          icon={passed ? <PartyPopper className="w-12 h-12 text-emerald-400" /> : <Plane className="w-12 h-12 text-rose-400" />}
          detail={
            <p>
              Acertaste <span className={`font-bold ${passed ? "text-emerald-400" : "text-rose-400"}`}>{correctCount}</span> de {total} decisiones
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
