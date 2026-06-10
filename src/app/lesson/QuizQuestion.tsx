"use client";

import { Check, AlertCircle } from "lucide-react";

interface Props {
  question: string;
  options: string[];
  correctAnswer: number;
  selectedOption: number | null;
  isChecked: boolean;
  /** Si es false, al comprobar no se revela cuál era la correcta (modo examen) */
  revealCorrect?: boolean;
  onSelect: (index: number) => void;
}

export default function QuizQuestion({
  question,
  options,
  correctAnswer,
  selectedOption,
  isChecked,
  revealCorrect = true,
  onSelect,
}: Props) {
  return (
    <div className="flex flex-col h-full">
      <h2 className="text-2xl md:text-3xl font-bold mb-8">{question}</h2>

      <div className="space-y-4">
        {options?.map((opt, i) => {
          const isSelected = selectedOption === i;
          let stateClass = "bg-zinc-900 border-zinc-800 text-white hover:border-primary hover:bg-primary/5";

          if (isChecked && revealCorrect) {
            if (i === correctAnswer) {
              stateClass = "bg-emerald-500/10 border-emerald-500 text-emerald-400";
            } else if (isSelected) {
              stateClass = "bg-rose-500/10 border-rose-500 text-rose-400";
            } else {
              stateClass = "bg-zinc-900 border-zinc-800 text-zinc-500 opacity-50";
            }
          } else if (isSelected) {
            stateClass = "bg-primary/20 border-primary text-white ring-2 ring-primary/30";
          }

          return (
            <button
              key={i}
              disabled={isChecked}
              onClick={() => onSelect(i)}
              className={`w-full text-left p-5 rounded-2xl border-2 transition-all flex justify-between items-center ${stateClass}`}
            >
              <span className="text-lg font-medium">{opt}</span>
              {isChecked && revealCorrect && i === correctAnswer && <Check className="w-6 h-6" />}
              {isChecked && revealCorrect && isSelected && i !== correctAnswer && <AlertCircle className="w-6 h-6" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
