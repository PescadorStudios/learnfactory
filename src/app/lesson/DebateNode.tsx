"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Loader2, Send, Swords } from "lucide-react";
import { debateTurn } from "../actions";
import type { AttemptInput, DebateMessage, LessonData, SocraticEvaluation } from "@/lib/types";
import { XP } from "@/lib/gamification";
import LessonHeader from "./LessonHeader";
import SocraticFeedback from "./SocraticFeedback";

interface Props {
  routeId: string;
  token: string;
  lesson: LessonData;
  onComplete: (input: AttemptInput) => void;
  onExit: () => void;
}

const MAX_STUDENT_TURNS = 3;

export default function DebateNode({ token, lesson, onComplete, onExit }: Props) {
  const [transcript, setTranscript] = useState<DebateMessage[]>([]);
  const [feedbackFinal, setFeedbackFinal] = useState<SocraticEvaluation | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    debateTurn(token, lesson.topic, lesson.title, lesson.sintesis, []).then(turn => {
      setTranscript([{ rol: "ia", texto: turn.mensajeIA }]);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, thinking, feedbackFinal]);

  const studentTurns = transcript.filter(m => m.rol === "estudiante").length;
  const progress = feedbackFinal ? 100 : (studentTurns / MAX_STUDENT_TURNS) * 100;

  const handleSend = async () => {
    const text = input.trim();
    if (text.length < 10 || thinking || feedbackFinal) return;

    const updated: DebateMessage[] = [...transcript, { rol: "estudiante", texto: text }];
    setTranscript(updated);
    setInput("");
    setThinking(true);

    const turn = await debateTurn(token, lesson.topic, lesson.title, lesson.sintesis, updated);
    const finalTranscript: DebateMessage[] = [...updated, { rol: "ia", texto: turn.mensajeIA }];
    setTranscript(finalTranscript);
    setThinking(false);

    if (turn.esCierre && turn.feedbackFinal) {
      setFeedbackFinal(turn.feedbackFinal);
    }
  };

  const handleFinish = () => {
    const puntuacion = feedbackFinal?.puntuacion ?? 0;
    onComplete({
      stars: puntuacion, // el feedback ya es 0-5
      passed: true,
      xp: XP.debateBase + puntuacion * XP.perSocraticPoint,
      detail: { socratic: [puntuacion] },
      masteryUpdates: lesson.conceptIds.map(conceptId => ({ conceptId, delta: 6 * puntuacion })),
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-12 h-12 text-secondary animate-spin mb-4" />
        <p className="text-zinc-400">La IA está preparando su postura para el debate...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      <LessonHeader progress={progress} onExit={onExit} />

      <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6 overflow-y-auto">
        <div className="text-center mb-6">
          <span className="inline-flex items-center gap-2 uppercase tracking-widest text-sm font-bold text-secondary">
            <Swords className="w-4 h-4" /> Debate: {lesson.title}
          </span>
          <p className="text-zinc-500 text-sm mt-2">
            La IA defenderá una postura. Rebátela usando lo que dice el material.
          </p>
        </div>

        <div className="space-y-4 pb-6">
          {transcript.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.rol === "estudiante" ? "justify-end" : "justify-start"}`}
            >
              <div className={`relative max-w-[85%] p-4 rounded-2xl leading-relaxed ${
                msg.rol === "estudiante"
                  ? "bg-primary/20 border border-primary/40 text-zinc-100 rounded-br-sm"
                  : "bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-bl-sm"
              }`}>
                {msg.rol === "ia" && (
                  <div className="absolute -left-2 -top-2 w-7 h-7 bg-secondary rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-secondary/50">
                    IA
                  </div>
                )}
                {msg.texto}
              </div>
            </motion.div>
          ))}

          {thinking && (
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> La IA está contraargumentando...
            </div>
          )}

          {feedbackFinal && <SocraticFeedback evaluation={feedbackFinal} />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Barra inferior: input del debate o cierre */}
      <div className="border-t border-zinc-900 p-6 bg-zinc-950">
        <div className="max-w-2xl mx-auto">
          {feedbackFinal ? (
            <button
              onClick={handleFinish}
              className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
            >
              Finalizar Debate
            </button>
          ) : (
            <div className="flex gap-3 items-end">
              <textarea
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 min-h-[80px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary/50 resize-none transition-all"
                placeholder="Escribe tu argumento..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={thinking}
              />
              <button
                onClick={handleSend}
                disabled={input.trim().length < 10 || thinking}
                className="shrink-0 w-14 h-14 rounded-2xl bg-secondary text-white flex items-center justify-center hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
