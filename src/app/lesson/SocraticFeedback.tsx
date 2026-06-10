"use client";

import { motion } from "framer-motion";
import { Star, ThumbsUp, Wrench, Lightbulb } from "lucide-react";
import type { SocraticEvaluation } from "@/lib/types";

export default function SocraticFeedback({ evaluation }: { evaluation: SocraticEvaluation }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5"
    >
      {/* Puntuación en estrellas (0-5) */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`w-8 h-8 ${i <= evaluation.puntuacion ? "text-amber-400 fill-current" : "text-zinc-700"}`}
          />
        ))}
      </div>

      {evaluation.fortalezas.length > 0 && (
        <div>
          <h4 className="flex items-center gap-2 text-emerald-400 font-bold mb-2">
            <ThumbsUp className="w-4 h-4" /> Lo que hiciste bien
          </h4>
          <ul className="space-y-1">
            {evaluation.fortalezas.map((f, i) => (
              <li key={i} className="text-zinc-300 text-sm pl-6 relative">
                <span className="absolute left-0 text-emerald-500">•</span> {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.mejoras.length > 0 && (
        <div>
          <h4 className="flex items-center gap-2 text-amber-400 font-bold mb-2">
            <Wrench className="w-4 h-4" /> Para afinar
          </h4>
          <ul className="space-y-1">
            {evaluation.mejoras.map((m, i) => (
              <li key={i} className="text-zinc-300 text-sm pl-6 relative">
                <span className="absolute left-0 text-amber-500">•</span> {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.ideaClave && (
        <div className="bg-primary/10 border border-primary/30 rounded-xl p-4">
          <h4 className="flex items-center gap-2 text-primary font-bold mb-1">
            <Lightbulb className="w-4 h-4" /> Idea clave
          </h4>
          <p className="text-zinc-200 text-sm leading-relaxed">{evaluation.ideaClave}</p>
        </div>
      )}
    </motion.div>
  );
}
