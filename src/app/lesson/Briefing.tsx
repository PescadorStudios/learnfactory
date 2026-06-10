"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Sparkles, ChevronRight } from "lucide-react";
import type { BriefingCard } from "@/lib/types";

interface Props {
  cards: BriefingCard[];
  onFinish: (predictCorrect: boolean) => void;
  onExit: () => void;
}

const KIND_GLOW: Record<string, string> = {
  hook: "shadow-primary/30 bg-primary/10 border-primary/30",
  recap: "shadow-secondary/30 bg-secondary/10 border-secondary/30",
  context: "shadow-accent/30 bg-accent/10 border-accent/30",
  vocab: "shadow-emerald-500/30 bg-emerald-500/10 border-emerald-500/30",
  predict: "shadow-amber-500/30 bg-amber-500/10 border-amber-500/30",
};

export default function Briefing({ cards, onFinish, onExit }: Props) {
  const [index, setIndex] = useState(0);
  const [predictChoice, setPredictChoice] = useState<number | null>(null);
  const [predictCorrect, setPredictCorrect] = useState(false);

  const card = cards[index];
  const isLast = index === cards.length - 1;
  const isPredictPending = card.kind === "predict" && predictChoice === null;

  const advance = () => {
    if (isPredictPending) return;
    if (isLast) {
      onFinish(predictCorrect);
    } else {
      setIndex(i => i + 1);
    }
  };

  const handlePredict = (i: number) => {
    if (predictChoice !== null || card.kind !== "predict") return;
    setPredictChoice(i);
    if (i === card.correctIndex) setPredictCorrect(true);
  };

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Barra estilo stories: segmentos + salir + saltar */}
      <header className="p-4 md:p-6 max-w-2xl w-full mx-auto">
        <div className="flex gap-1.5 mb-4">
          {cards.map((_, i) => (
            <div key={i} className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-white rounded-full"
                initial={{ width: i < index ? "100%" : 0 }}
                animate={{ width: i <= index ? "100%" : 0 }}
                transition={{ duration: i === index ? 0.5 : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button onClick={onExit} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
          <button
            onClick={() => onFinish(predictCorrect)}
            className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors uppercase tracking-wider font-bold"
          >
            Saltar intro
          </button>
        </div>
      </header>

      {/* Tarjeta (toda el área avanza al tocar, excepto la predicción sin responder) */}
      <div
        className={`flex-1 flex flex-col max-w-2xl w-full mx-auto p-6 ${!isPredictPending ? "cursor-pointer" : ""}`}
        onClick={advance}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -40, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 200, damping: 24 }}
            className="flex-1 flex flex-col justify-center items-center text-center"
          >
            <motion.div
              initial={{ scale: 0, rotate: -15 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
              className={`w-24 h-24 rounded-3xl border flex items-center justify-center text-5xl mb-8 shadow-2xl ${KIND_GLOW[card.kind] || KIND_GLOW.hook}`}
            >
              {card.emoji}
            </motion.div>

            <span className="uppercase tracking-widest text-sm font-bold text-zinc-500 mb-4 block">
              {card.title}
            </span>

            {card.kind === "vocab" ? (
              <div className="w-full max-w-md space-y-3 text-left" onClick={(e) => e.stopPropagation()}>
                {card.terms.map((t, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.15 }}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
                  >
                    <span className="font-bold text-emerald-400">{t.termino}</span>
                    <p className="text-zinc-400 text-sm mt-1">{t.definicion}</p>
                  </motion.div>
                ))}
              </div>
            ) : card.kind === "predict" ? (
              <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl md:text-2xl font-medium leading-relaxed text-zinc-100 mb-6">
                  {card.question}
                </h2>
                <div className="space-y-3">
                  {card.options.map((opt, i) => {
                    const chosen = predictChoice === i;
                    const revealed = predictChoice !== null;
                    let cls = "bg-zinc-900 border-zinc-800 text-white hover:border-amber-500 hover:bg-amber-500/5";
                    if (revealed) {
                      if (i === card.correctIndex) cls = "bg-emerald-500/10 border-emerald-500 text-emerald-400";
                      else if (chosen) cls = "bg-rose-500/10 border-rose-500 text-rose-400";
                      else cls = "bg-zinc-900 border-zinc-800 text-zinc-500 opacity-50";
                    }
                    return (
                      <button
                        key={i}
                        disabled={predictChoice !== null}
                        onClick={() => handlePredict(i)}
                        className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex justify-between items-center ${cls}`}
                      >
                        <span className="font-medium">{opt}</span>
                        {predictChoice !== null && i === card.correctIndex && <Check className="w-5 h-5" />}
                      </button>
                    );
                  })}
                </div>

                <AnimatePresence>
                  {predictChoice !== null && (
                    <motion.div
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-left"
                    >
                      <div className="flex items-center gap-2 text-amber-400 font-bold mb-1">
                        <Sparkles className="w-4 h-4" />
                        {predictChoice === card.correctIndex ? "¡Buena intuición! +5 XP" : "¡Sorpresa!"}
                      </div>
                      <p className="text-zinc-200 text-sm leading-relaxed">{card.reveal}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <h2 className="text-2xl md:text-3xl font-medium leading-relaxed text-zinc-100 max-w-lg">
                {card.text}
              </h2>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Pie: avanzar */}
      <div className="p-6 max-w-2xl w-full mx-auto">
        {isPredictPending ? (
          <p className="text-center text-zinc-600 text-sm">Elige una opción para continuar</p>
        ) : isLast || (card.kind === "predict" && predictChoice !== null) ? (
          <button
            onClick={advance}
            className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
          >
            {isLast ? "¡Empezar la lección!" : "Continuar"}
            <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <p className="text-center text-zinc-600 text-sm animate-pulse">Toca para continuar</p>
        )}
      </div>
    </main>
  );
}
