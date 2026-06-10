"use client";

import { motion } from "framer-motion";
import { X, Heart } from "lucide-react";

interface Props {
  progress: number; // 0-100
  lives?: number;
  onExit: () => void;
}

export default function LessonHeader({ progress, lives, onExit }: Props) {
  return (
    <header className="flex items-center justify-between p-4 md:p-6 max-w-4xl w-full mx-auto">
      <button
        onClick={onExit}
        className="text-zinc-500 hover:text-white transition-colors"
      >
        <X className="w-6 h-6" />
      </button>

      <div className="flex-1 mx-6 h-4 bg-zinc-900 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full relative"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 50 }}
        >
          {/* Glossy reflection on progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1/2 bg-white/20 rounded-full" />
        </motion.div>
      </div>

      {typeof lives === "number" ? (
        <div className="flex items-center gap-2 text-rose-500 font-bold">
          <Heart className="w-6 h-6 fill-current" />
          <span>{lives}</span>
        </div>
      ) : (
        <div className="w-12" />
      )}
    </header>
  );
}
