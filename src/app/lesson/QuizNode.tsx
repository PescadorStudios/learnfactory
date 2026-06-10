"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Loader2, RefreshCw, Trophy } from "lucide-react";
import { generateQuizNode } from "../actions";
import type { NodeResult, QuizQuestionData, Sintesis } from "@/lib/types";
import { XP, getStudiedConceptIds } from "@/lib/gamification";
import LessonHeader from "./LessonHeader";
import QuizQuestion from "./QuizQuestion";

interface Props {
  topic: string;
  nodeId: string;
  nodeTitle: string;
  sintesis: Sintesis;
  conceptIds: string[];
  isReview: boolean;
  onComplete: (result: NodeResult) => void;
  onExit: () => void;
}

export default function QuizNode({ topic, nodeId, nodeTitle, sintesis, conceptIds, isReview, onComplete, onExit }: Props) {
  const [questions, setQuestions] = useState<QuizQuestionData[]>([]);
  const [loading, setLoading] = useState(true);

  const [current, setCurrent] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isChecked, setIsChecked] = useState(false);
  const [lives, setLives] = useState(3);
  const [results, setResults] = useState<boolean[]>([]);
  const [finished, setFinished] = useState(false);

  const cacheKey = `learnfactory_quiznode_${topic}_${nodeId}`;

  useEffect(() => {
    let ignore = false;

    async function loadQuiz() {
      // En modo repaso siempre se generan preguntas frescas
      if (!isReview) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (!ignore && Array.isArray(parsed?.preguntas) && parsed.preguntas.length > 0) {
              setQuestions(parsed.preguntas);
              setLoading(false);
              return;
            }
          } catch {}
        }
      }

      const data = await generateQuizNode(
        topic,
        sintesis,
        conceptIds,
        isReview ? [] : getStudiedConceptIds(topic, conceptIds),
        isReview
      );
      if (!ignore) {
        setQuestions(data.preguntas);
        setLoading(false);
        if (!isReview) localStorage.setItem(cacheKey, JSON.stringify(data));
      }
    }
    loadQuiz();

    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, nodeId, isReview]);

  if (loading || questions.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <p className="text-zinc-400">{isReview ? "Preparando tu sesión de repaso..." : "Generando quiz de repaso acumulativo..."}</p>
      </div>
    );
  }

  const question = questions[current];
  const progress = (current / questions.length) * 100;
  const correctCount = results.filter(Boolean).length;

  const handleCheck = () => {
    if (selectedOption === null) return;
    setIsChecked(true);
    const correct = selectedOption === question.correctAnswer;
    setResults(r => [...r, correct]);
    if (!correct) setLives(l => Math.max(0, l - 1));
  };

  const handleNext = () => {
    if (lives === 0 || current >= questions.length - 1) {
      setFinished(true);
    } else {
      setCurrent(c => c + 1);
      setSelectedOption(null);
      setIsChecked(false);
    }
  };

  const handleRetry = () => {
    setCurrent(0);
    setSelectedOption(null);
    setIsChecked(false);
    setLives(3);
    setResults([]);
    setFinished(false);
  };

  const handleFinish = () => {
    const masteryUpdates = questions.slice(0, results.length).map((q, i) => ({
      conceptId: q.conceptId || conceptIds[0] || "",
      delta: results[i] ? 20 : -10,
    })).filter(u => u.conceptId);

    const xpEvents = isReview
      ? [{ action: "repaso_completado", xp: XP.reviewSession }]
      : [{ action: "quiz_node_completado", xp: correctCount * XP.quizCorrectFirstTry }];

    onComplete({ xpEvents, masteryUpdates, isReview });
  };

  // ── Pantalla de resultados ──
  if (finished) {
    const total = results.length;
    const failed = lives === 0 && total < questions.length;

    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col">
        <LessonHeader progress={100} lives={lives} onExit={onExit} />
        <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 ${failed ? "bg-rose-500/10 border border-rose-500/40" : "bg-emerald-500/10 border border-emerald-500/40"}`}>
            <Trophy className={`w-10 h-10 ${failed ? "text-rose-500" : "text-emerald-500"}`} />
          </motion.div>
          <h2 className="text-3xl font-bold mb-2">
            {failed ? "Te quedaste sin vidas" : isReview ? "¡Repaso completado!" : "¡Quiz completado!"}
          </h2>
          <p className="text-zinc-400 mb-8">
            Acertaste <span className="text-primary font-bold">{correctCount}</span> de {questions.length} preguntas.
          </p>

          {failed ? (
            <button
              onClick={handleRetry}
              className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-5 h-5" /> Reintentar
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
            >
              Finalizar
            </button>
          )}
        </div>
      </main>
    );
  }

  const isCorrect = isChecked && selectedOption === question.correctAnswer;
  const isWrong = isChecked && selectedOption !== question.correctAnswer;

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      <LessonHeader progress={progress} lives={lives} onExit={onExit} />

      <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6 md:p-12">
        <div className="text-center mb-4">
          <span className="uppercase tracking-widest text-sm font-bold text-primary">
            {isReview ? "Repaso" : nodeTitle} · {current + 1}/{questions.length}
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
              isChecked={isChecked}
              onSelect={setSelectedOption}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Action Bar */}
      <div className={`border-t p-6 transition-colors ${
        isCorrect ? 'bg-emerald-950 border-emerald-900' :
        isWrong ? 'bg-rose-950 border-rose-900' :
        'bg-zinc-950 border-zinc-900'
      }`}>
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-6">
          {isChecked ? (
            <div className="flex items-center gap-4 min-w-0">
              <div className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center ${
                isCorrect ? 'bg-emerald-500 text-emerald-950' : 'bg-rose-500 text-rose-950'
              }`}>
                {isCorrect ? <Check className="w-8 h-8" /> : <X className="w-8 h-8" />}
              </div>
              <div className="min-w-0">
                <h3 className={`font-bold text-xl ${isCorrect ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {isCorrect ? '¡Excelente!' : 'Casi lo tienes'}
                </h3>
                {isWrong && (
                  <p className="text-rose-400/80 text-sm">La respuesta correcta era: {question.options?.[question.correctAnswer]}</p>
                )}
                {question.explicacion && (
                  <p className={`text-sm mt-1 ${isCorrect ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                    {question.explicacion}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div />
          )}

          <button
            onClick={isChecked ? handleNext : handleCheck}
            disabled={selectedOption === null}
            className={`shrink-0 px-8 py-4 rounded-2xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed
              ${isCorrect ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400' :
                isWrong ? 'bg-rose-500 text-rose-950 hover:bg-rose-400' :
                'bg-primary text-white hover:bg-primary-hover'}
            `}
          >
            {isChecked ? "Continuar" : "Comprobar"}
          </button>
        </div>
      </div>
    </main>
  );
}
