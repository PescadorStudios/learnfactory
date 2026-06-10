"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Skull, Check, X, RefreshCw, Crown } from "lucide-react";
import { evaluateSocraticAnswer } from "../actions";
import { regenerateBoss } from "../routeActions";
import type { AttemptInput, BossExamData, LessonData, SocraticEvaluation } from "@/lib/types";
import { XP, starsForBoss } from "@/lib/gamification";
import LessonHeader from "./LessonHeader";
import SocraticFeedback from "./SocraticFeedback";
import QuizQuestion from "./QuizQuestion";

interface Props {
  routeId: string;
  token: string;
  lesson: LessonData;
  onComplete: (input: AttemptInput) => void;
  onExit: () => void;
}

const PASS_RATIO = 0.7;
const OPEN_QUESTION_MAX = 5; // la pregunta abierta vale 0-5

type Phase = "intro" | "exam" | "open" | "evaluating" | "results" | "regenerating";

export default function BossExam({ routeId, token, lesson, onComplete, onExit }: Props) {
  const [exam, setExam] = useState<BossExamData | null>(lesson.boss);
  const [phase, setPhase] = useState<Phase>("intro");

  const [current, setCurrent] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [openAnswer, setOpenAnswer] = useState("");
  const [openEvaluation, setOpenEvaluation] = useState<SocraticEvaluation | null>(null);

  if (!exam) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center">
        <p className="text-zinc-400 mb-6">El examen no está disponible. Vuelve al árbol y reintenta la generación.</p>
        <button onClick={onExit} className="px-8 py-4 rounded-2xl font-bold bg-primary text-white">Volver</button>
      </div>
    );
  }

  const totalPoints = exam.preguntas.length + OPEN_QUESTION_MAX;
  const passPoints = Math.ceil(totalPoints * PASS_RATIO);
  const mcCorrect = answers.filter((a, i) => a === exam.preguntas[i].correctAnswer).length;
  const score = mcCorrect + (openEvaluation?.puntuacion ?? 0);
  const passed = score >= passPoints;

  const handleNextQuestion = () => {
    if (selectedOption === null) return;
    const updated = [...answers, selectedOption];
    setAnswers(updated);
    setSelectedOption(null);
    if (updated.length >= exam.preguntas.length) {
      setPhase("open");
    } else {
      setCurrent(c => c + 1);
    }
  };

  const handleSubmitOpen = async () => {
    if (openAnswer.trim().length < 10) return;
    setPhase("evaluating");
    const evaluation = await evaluateSocraticAnswer(
      token,
      exam.preguntaAbierta.prompt,
      openAnswer.trim(),
      exam.preguntaAbierta.conceptContext
    );
    setOpenEvaluation(evaluation);
    setPhase("results");
  };

  const buildMasteryUpdates = () =>
    exam.preguntas.map((q, i) => ({
      conceptId: q.conceptId || lesson.conceptIds[0] || "",
      delta: answers[i] === q.correctAnswer ? 20 : -10,
    })).filter(u => u.conceptId);

  const buildDetail = () => ({
    bossPoints: score,
    bossTotal: totalPoints,
    quizCorrect: mcCorrect,
    quizTotal: exam.preguntas.length,
    socratic: openEvaluation ? [openEvaluation.puntuacion] : [],
  });

  const handleClaimVictory = () => {
    onComplete({
      stars: starsForBoss(score, totalPoints),
      passed: true,
      xp: XP.bossPass + mcCorrect * XP.quizCorrectFirstTry,
      detail: buildDetail(),
      masteryUpdates: buildMasteryUpdates(),
    });
  };

  const handleGiveUp = () => {
    onComplete({
      stars: starsForBoss(score, totalPoints),
      passed: false,
      xp: 0,
      detail: buildDetail(),
      masteryUpdates: buildMasteryUpdates(),
    });
  };

  const handleRetry = async () => {
    setPhase("regenerating");
    const fresh = await regenerateBoss(token, routeId, lesson.nodeId);
    setCurrent(0);
    setSelectedOption(null);
    setAnswers([]);
    setOpenAnswer("");
    setOpenEvaluation(null);
    if (fresh) setExam(fresh);
    setPhase("intro");
  };

  if (phase === "regenerating") {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-12 h-12 text-rose-500 animate-spin mb-4" />
        <p className="text-zinc-400">El Boss está preparando preguntas nuevas...</p>
      </div>
    );
  }

  // ── Intro ──
  if (phase === "intro") {
    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col">
        <LessonHeader progress={0} onExit={onExit} />
        <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            className="w-24 h-24 bg-rose-500/10 border border-rose-500/40 rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-rose-500/20"
          >
            <Skull className="w-12 h-12 text-rose-500" />
          </motion.div>
          <h1 className="text-4xl font-bold mb-3">Boss Battle</h1>
          <p className="text-zinc-400 mb-2">{lesson.title}: demuestra que dominas <span className="text-white font-semibold">todo</span> el material.</p>
          <ul className="text-zinc-500 text-sm space-y-1 mb-8">
            <li>{exam.preguntas.length} preguntas de opción múltiple (1 punto cada una)</li>
            <li>1 pregunta abierta sobre la tesis global (hasta {OPEN_QUESTION_MAX} puntos)</li>
            <li>Necesitas <span className="text-rose-400 font-bold">{passPoints} de {totalPoints} puntos</span> para vencer</li>
            <li>No verás las respuestas correctas hasta el final</li>
          </ul>
          <button
            onClick={() => setPhase("exam")}
            className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-rose-500 text-white hover:bg-rose-400 transition-all"
          >
            Comenzar el Examen
          </button>
        </div>
      </main>
    );
  }

  // ── Examen MC (sin feedback por pregunta) ──
  if (phase === "exam") {
    const question = exam.preguntas[current];
    const progress = (answers.length / (exam.preguntas.length + 1)) * 100;

    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col">
        <LessonHeader progress={progress} onExit={onExit} />
        <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6 md:p-12">
          <div className="text-center mb-4">
            <span className="uppercase tracking-widest text-sm font-bold text-rose-500">
              Boss Battle · {current + 1}/{exam.preguntas.length}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col justify-center"
            >
              <QuizQuestion
                question={question.question}
                options={question.options}
                correctAnswer={question.correctAnswer}
                selectedOption={selectedOption}
                isChecked={false}
                revealCorrect={false}
                onSelect={setSelectedOption}
              />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="border-t border-zinc-900 p-6 bg-zinc-950">
          <div className="max-w-4xl mx-auto flex justify-end">
            <button
              onClick={handleNextQuestion}
              disabled={selectedOption === null}
              className="px-8 py-4 rounded-2xl font-bold text-lg bg-rose-500 text-white hover:bg-rose-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {answers.length === exam.preguntas.length - 1 ? "Última: Pregunta Final" : "Siguiente"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Pregunta abierta final ──
  if (phase === "open" || phase === "evaluating") {
    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col">
        <LessonHeader progress={90} onExit={onExit} />
        <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6 md:p-12 justify-center">
          <span className="uppercase tracking-widest text-sm font-bold text-rose-500 mb-4 block text-center">
            Pregunta Final · La Tesis Global
          </span>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl mb-6 relative">
            <div className="absolute -left-3 -top-3 w-8 h-8 bg-rose-500 rounded-full flex items-center justify-center shadow-lg shadow-rose-500/50">
              <Skull className="w-5 h-5 text-white" />
            </div>
            <p className="text-xl leading-relaxed text-zinc-100">{exam.preguntaAbierta.prompt}</p>
          </div>

          {phase === "evaluating" ? (
            <div className="flex items-center justify-center gap-3 text-zinc-400 py-10">
              <Loader2 className="w-6 h-6 animate-spin text-rose-500" />
              <span>El Boss está evaluando tu respuesta final...</span>
            </div>
          ) : (
            <>
              <textarea
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 min-h-[160px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/50 resize-none transition-all mb-4"
                placeholder="Demuestra que entiendes el argumento completo del material..."
                value={openAnswer}
                onChange={(e) => setOpenAnswer(e.target.value)}
              />
              <button
                onClick={handleSubmitOpen}
                disabled={openAnswer.trim().length < 10}
                className="px-8 py-4 rounded-2xl font-bold text-lg bg-rose-500 text-white hover:bg-rose-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Entregar Examen
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  // ── Resultados ──
  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      <LessonHeader progress={100} onExit={onExit} />
      <div className="flex-1 max-w-2xl w-full mx-auto p-6 md:p-12 overflow-y-auto">
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={`w-24 h-24 mx-auto rounded-3xl flex items-center justify-center mb-6 border ${
              passed ? "bg-amber-500/10 border-amber-500/40 shadow-2xl shadow-amber-500/20" : "bg-rose-500/10 border-rose-500/40"
            }`}
          >
            {passed ? <Crown className="w-12 h-12 text-amber-400" /> : <Skull className="w-12 h-12 text-rose-500" />}
          </motion.div>
          <h1 className="text-4xl font-bold mb-2">{passed ? "¡Boss Derrotado!" : "El Boss resistió..."}</h1>
          <p className="text-zinc-400">
            Obtuviste <span className={`font-bold ${passed ? "text-amber-400" : "text-rose-400"}`}>{score} de {totalPoints}</span> puntos
            (necesitabas {passPoints}).
          </p>
        </div>

        {/* Desglose de preguntas */}
        <div className="space-y-3 mb-6">
          {exam.preguntas.map((q, i) => {
            const correct = answers[i] === q.correctAnswer;
            return (
              <div key={i} className={`p-4 rounded-2xl border ${correct ? "bg-emerald-500/5 border-emerald-500/30" : "bg-rose-500/5 border-rose-500/30"}`}>
                <div className="flex items-start gap-3">
                  {correct
                    ? <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    : <X className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-200 text-sm">{q.question}</p>
                    {!correct && (
                      <p className="text-rose-400/80 text-xs mt-1">Correcta: {q.options[q.correctAnswer]}</p>
                    )}
                    <p className="text-zinc-500 text-xs mt-1">{q.explicacion}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {openEvaluation && (
          <div className="mb-8">
            <h3 className="font-bold text-zinc-300 mb-3">Tu respuesta final ({openEvaluation.puntuacion}/{OPEN_QUESTION_MAX} puntos)</h3>
            <SocraticFeedback evaluation={openEvaluation} />
          </div>
        )}

        <div className="flex flex-col gap-3 pb-12">
          {passed ? (
            <button
              onClick={handleClaimVictory}
              className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-amber-500 text-amber-950 hover:bg-amber-400 transition-all"
            >
              Reclamar Victoria (+{XP.bossPass} XP)
            </button>
          ) : (
            <>
              <button
                onClick={handleRetry}
                className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-rose-500 text-white hover:bg-rose-400 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-5 h-5" /> Reintentar con preguntas nuevas
              </button>
              <button
                onClick={handleGiveUp}
                className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-all"
              >
                Volver al árbol y repasar
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
