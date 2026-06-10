"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Loader2, Quote } from "lucide-react";
import { generateMicroLesson, evaluateSocraticAnswer } from "../actions";
import type { AudioIntroData, LessonStep, MicroLessonData, NodeResult, NodeType, Sintesis, SocraticEvaluation } from "@/lib/types";
import { XP, getStudiedConceptIds } from "@/lib/gamification";
import { getAudio, putAudio, base64ToWavBlob } from "@/lib/audioCache";
import LessonHeader from "./LessonHeader";
import SocraticFeedback from "./SocraticFeedback";
import QuizQuestion from "./QuizQuestion";
import AudioIntroGame from "./AudioIntroGame";

interface Props {
  topic: string;
  nodeId: string;
  nodeTitle: string;
  nodeType: NodeType;
  sintesis: Sintesis;
  conceptIds: string[];
  onComplete: (result: NodeResult) => void;
  onExit: () => void;
}

// Deduplica generaciones concurrentes (React monta los efectos dos veces en dev):
// sin esto se disparan dos llamadas a Gemini+TTS y la segunda puede pisar el caché
const inflightLessons = new Map<string, Promise<{ lesson: MicroLessonData; blob: Blob | null }>>();

export default function MicroLesson({ topic, nodeId, nodeTitle, nodeType, sintesis, conceptIds, onComplete, onExit }: Props) {
  const [lessonSteps, setLessonSteps] = useState<LessonStep[]>([]);
  const [audioIntro, setAudioIntro] = useState<AudioIntroData | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [phase, setPhase] = useState<"audio" | "steps">("audio");
  const [loading, setLoading] = useState(true);

  const [currentStep, setCurrentStep] = useState(0);
  const [lives, setLives] = useState(3);

  // Estado del paso quiz
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswerChecked, setIsAnswerChecked] = useState(false);

  // Estado de pasos abiertos (elaboration / debate)
  const [answerText, setAnswerText] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<SocraticEvaluation | null>(null);

  // Acumuladores del resultado del nodo
  const xpEvents = useRef<Array<{ action: string; xp: number }>>([]);
  const masteryUpdates = useRef<Array<{ conceptId: string; delta: number }>>([]);

  useEffect(() => {
    let ignore = false;

    const audioKey = `audio_${topic}_${nodeId}`;

    function applyLesson(lesson: MicroLessonData, blob: Blob | null) {
      setLessonSteps(lesson.steps);
      setAudioIntro(lesson.audioIntro);
      setAudioBlob(blob);
      setPhase(lesson.audioIntro && blob ? "audio" : "steps");
      setLoading(false);
    }

    async function generateAndCache(cacheKey: string): Promise<{ lesson: MicroLessonData; blob: Blob | null }> {
      const { lesson, audioWavBase64 } = await generateMicroLesson(
        topic, nodeTitle, nodeType, sintesis, conceptIds,
        getStudiedConceptIds(topic, conceptIds)
      );
      let blob: Blob | null = null;
      if (lesson.audioIntro && audioWavBase64) {
        blob = base64ToWavBlob(audioWavBase64);
        await putAudio(audioKey, blob);
      }
      // Cachear metadatos (sin el base64) solo si la lección quedó completa con audio:
      // un resultado sin audio no debe quedar fijado (se reintenta en la próxima visita)
      if (lesson.audioIntro) {
        localStorage.setItem(cacheKey, JSON.stringify(lesson));
      }
      return { lesson, blob };
    }

    async function loadLesson() {
      // Intentar cache primero (formatos viejos o sin audio se regeneran)
      const cacheKey = `learnfactory_lesson_${topic}_${nodeId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed: MicroLessonData = JSON.parse(cached);
          if (parsed?.audioIntro && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
            // El WAV vive en IndexedDB; si falta, se regenera todo
            const blob = await getAudio(audioKey);
            if (blob) {
              if (!ignore) applyLesson(parsed, blob);
              return;
            }
          }
        } catch {}
      }

      setLoading(true);
      let pending = inflightLessons.get(cacheKey);
      if (!pending) {
        pending = generateAndCache(cacheKey);
        inflightLessons.set(cacheKey, pending);
        pending.finally(() => inflightLessons.delete(cacheKey));
      }
      const { lesson, blob } = await pending;
      if (!ignore) {
        applyLesson(lesson, blob);
      }
    }
    loadLesson();

    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, nodeId, nodeTitle, nodeType]);

  if (loading || lessonSteps.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <p className="text-zinc-400">🎙️ Grabando tu podcast de contexto...</p>
        <p className="text-zinc-600 text-sm mt-2">La IA está narrando esta lección con voz (puede tardar un poco)</p>
      </div>
    );
  }

  // Fase 1: podcast de contexto con juego de atención
  if (phase === "audio" && audioIntro && audioBlob) {
    return (
      <AudioIntroGame
        nodeTitle={nodeTitle}
        audioBlob={audioBlob}
        intro={audioIntro}
        onFinish={() => {
          xpEvents.current.push({ action: "atencion_comprobada", xp: XP.audioFocusPass });
          setPhase("steps");
        }}
        onExit={onExit}
      />
    );
  }

  const progress = (currentStep / lessonSteps.length) * 100;
  const stepData = lessonSteps[currentStep];

  const resetStepState = () => {
    setSelectedOption(null);
    setIsAnswerChecked(false);
    setAnswerText("");
    setEvaluation(null);
  };

  const handleNext = () => {
    if (currentStep < lessonSteps.length - 1) {
      setCurrentStep(c => c + 1);
      resetStepState();
    } else {
      xpEvents.current.push({ action: "leccion_completada", xp: XP.lessonComplete });
      onComplete({ xpEvents: xpEvents.current, masteryUpdates: masteryUpdates.current });
    }
  };

  const handleCheckAnswer = () => {
    if (stepData.type !== "quiz" || selectedOption === null) return;
    setIsAnswerChecked(true);
    const correct = selectedOption === stepData.correctAnswer;
    const conceptId = stepData.conceptId || conceptIds[0] || "";
    if (correct) {
      xpEvents.current.push({ action: "quiz_correcto", xp: XP.quizCorrectFirstTry });
      if (conceptId) masteryUpdates.current.push({ conceptId, delta: 20 });
    } else {
      setLives(l => Math.max(0, l - 1));
      if (conceptId) masteryUpdates.current.push({ conceptId, delta: -10 });
    }
  };

  const handleSubmitAnswer = async () => {
    if ((stepData.type !== "elaboration" && stepData.type !== "debate") || answerText.trim().length < 10) return;
    setEvaluating(true);
    const result = await evaluateSocraticAnswer(
      stepData.prompt,
      answerText.trim(),
      stepData.conceptContext || `Tema: ${topic}. Subtema: ${nodeTitle}.`
    );
    setEvaluating(false);
    setEvaluation(result);
    xpEvents.current.push({ action: "respuesta_socratica", xp: result.puntuacion * XP.perSocraticPoint });
    for (const cid of conceptIds) {
      masteryUpdates.current.push({ conceptId: cid, delta: 10 * result.puntuacion });
    }
  };

  const isOpenStep = stepData.type === "elaboration" || stepData.type === "debate";

  // Lógica del botón principal
  let buttonLabel = "Continuar";
  let buttonAction = handleNext;
  let buttonDisabled = false;

  if (stepData.type === "quiz" && !isAnswerChecked) {
    buttonLabel = "Comprobar";
    buttonAction = handleCheckAnswer;
    buttonDisabled = selectedOption === null;
  } else if (isOpenStep && !evaluation) {
    buttonLabel = evaluating ? "Evaluando..." : "Enviar Respuesta";
    buttonAction = handleSubmitAnswer;
    buttonDisabled = answerText.trim().length < 10 || evaluating;
  }

  const quizCorrect = stepData.type === "quiz" && isAnswerChecked && selectedOption === stepData.correctAnswer;
  const quizWrong = stepData.type === "quiz" && isAnswerChecked && selectedOption !== stepData.correctAnswer;

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      <LessonHeader progress={progress} lives={lives} onExit={onExit} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6 md:p-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col justify-center"
          >
            {stepData.type === "theory" || stepData.type === "analogy" ? (
              // Theory / Analogy Card
              <div className="text-center">
                <span className="uppercase tracking-widest text-sm font-bold text-primary mb-4 block">
                  {stepData.title}
                </span>
                <h2 className="text-2xl md:text-4xl font-medium leading-relaxed text-zinc-100">
                  {stepData.content}
                </h2>
                {stepData.cita && (
                  <blockquote className="mt-8 bg-zinc-900/70 border-l-4 border-primary rounded-r-2xl p-5 text-left">
                    <div className="flex items-center gap-2 text-primary text-xs uppercase tracking-widest font-bold mb-2">
                      <Quote className="w-4 h-4" /> Del material
                    </div>
                    <p className="text-zinc-300 italic leading-relaxed">“{stepData.cita}”</p>
                  </blockquote>
                )}
              </div>
            ) : isOpenStep ? (
              // Elaboración / Pregunta socrática
              <div className="flex flex-col h-full justify-center">
                <span className="uppercase tracking-widest text-sm font-bold text-secondary mb-4 block text-center">
                  {stepData.title}
                </span>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl mb-6 relative">
                  <div className="absolute -left-3 -top-3 w-8 h-8 bg-secondary rounded-full flex items-center justify-center font-bold text-white shadow-lg shadow-secondary/50">
                    IA
                  </div>
                  <p className="text-xl leading-relaxed text-zinc-100">{stepData.prompt}</p>
                </div>

                {evaluation ? (
                  <SocraticFeedback evaluation={evaluation} />
                ) : evaluating ? (
                  <div className="flex items-center justify-center gap-3 text-zinc-400 py-10">
                    <Loader2 className="w-6 h-6 animate-spin text-secondary" />
                    <span>La IA está leyendo tu respuesta...</span>
                  </div>
                ) : (
                  <div className="relative">
                    <textarea
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 min-h-[120px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary/50 resize-none transition-all"
                      placeholder="Escribe tu respuesta aquí..."
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                    />
                    <div className="absolute right-3 bottom-3 text-xs text-zinc-600">
                      Explica con tus propias palabras
                    </div>
                  </div>
                )}
              </div>
            ) : stepData.type === "quiz" ? (
              // Quiz Card
              <QuizQuestion
                question={stepData.question}
                options={stepData.options}
                correctAnswer={stepData.correctAnswer}
                selectedOption={selectedOption}
                isChecked={isAnswerChecked}
                onSelect={setSelectedOption}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Action Bar */}
      <div className={`border-t p-6 transition-colors ${
        quizCorrect ? 'bg-emerald-950 border-emerald-900' :
        quizWrong ? 'bg-rose-950 border-rose-900' :
        'bg-zinc-950 border-zinc-900'
      }`}>
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-6">
          {isAnswerChecked && stepData.type === "quiz" ? (
            <div className="flex items-center gap-4 min-w-0">
              <div className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center ${
                quizCorrect ? 'bg-emerald-500 text-emerald-950' : 'bg-rose-500 text-rose-950'
              }`}>
                {quizCorrect ? <Check className="w-8 h-8" /> : <X className="w-8 h-8" />}
              </div>
              <div className="min-w-0">
                <h3 className={`font-bold text-xl ${quizCorrect ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {quizCorrect ? '¡Excelente!' : 'Casi lo tienes'}
                </h3>
                {quizWrong && (
                  <p className="text-rose-400/80 text-sm">La respuesta correcta era: {stepData.options?.[stepData.correctAnswer]}</p>
                )}
                {stepData.explicacion && (
                  <p className={`text-sm mt-1 ${quizCorrect ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                    {stepData.explicacion}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div /> // Empty div to keep alignment
          )}

          <button
            onClick={buttonAction}
            disabled={buttonDisabled}
            className={`shrink-0 px-8 py-4 rounded-2xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed
              ${quizCorrect ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400' :
                quizWrong ? 'bg-rose-500 text-rose-950 hover:bg-rose-400' :
                'bg-primary text-white hover:bg-primary-hover'}
            `}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </main>
  );
}
