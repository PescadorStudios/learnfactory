"use client";

import { motion } from "framer-motion";
import { X, Play, Pause, RefreshCw } from "lucide-react";

/** Barras de ecualizador animadas mientras suena el podcast. */
export function EqBars({ paused, bars = 24 }: { paused: boolean; bars?: number }) {
  return (
    <div className="flex items-center gap-1.5 h-32">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-2 rounded-full bg-gradient-to-t from-primary to-accent"
          animate={
            paused
              ? { height: 8 }
              : { height: [8, 12 + ((i * 37) % 90), 20 + ((i * 53) % 60), 8 + ((i * 23) % 100), 8] }
          }
          transition={
            paused
              ? { duration: 0.3 }
              : { duration: 1.2 + (i % 5) * 0.18, repeat: Infinity, ease: "easeInOut" }
          }
        />
      ))}
    </div>
  );
}

/** Barra inferior: pausa + progreso + tiempo. */
export function AudioControls({
  currentTime,
  duration,
  isPaused,
  onTogglePause,
  disabled = false,
}: {
  currentTime: number;
  duration: number;
  isPaused: boolean;
  onTogglePause: () => void;
  disabled?: boolean;
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <div className="mt-6 flex items-center gap-4">
      <button
        onClick={onTogglePause}
        disabled={disabled}
        className="w-12 h-12 shrink-0 rounded-full bg-zinc-900 border border-zinc-700 text-white flex items-center justify-center hover:border-primary transition-colors disabled:opacity-40"
      >
        {isPaused ? <Play className="w-5 h-5 ml-0.5 fill-current" /> : <Pause className="w-5 h-5 fill-current" />}
      </button>
      <div className="flex-1 h-2 bg-zinc-900 rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-xs text-zinc-500 tabular-nums shrink-0">
        {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Cabecera común: salir + marcador de puntos. */
export function GameHeader({
  onExit,
  dots,
}: {
  onExit: () => void;
  dots?: Array<"correct" | "wrong" | "pending">;
}) {
  return (
    <header className="flex items-center justify-between p-4 md:p-6 max-w-2xl w-full mx-auto">
      <button onClick={onExit} className="text-zinc-500 hover:text-white transition-colors">
        <X className="w-6 h-6" />
      </button>
      {dots && (
        <div className="flex gap-2">
          {dots.map((d, i) => (
            <motion.div
              key={i}
              animate={d !== "pending" ? { scale: [1, 1.4, 1] } : {}}
              className={`w-3.5 h-3.5 rounded-full border ${
                d === "correct" ? "bg-emerald-500 border-emerald-400" :
                d === "wrong" ? "bg-rose-500 border-rose-400" :
                "bg-zinc-900 border-zinc-700"
              }`}
            />
          ))}
        </div>
      )}
      <div className="w-6" />
    </header>
  );
}

/** Pantalla de instrucciones: explica CÓMO se juega antes de empezar. */
export function GameBriefing({
  icon,
  color,
  title,
  subtitle,
  howTo,
  extra,
  onStart,
  startLabel = "Comenzar",
}: {
  icon: React.ReactNode;
  color: string; // ej. "text-amber-400" / "border-amber-500/30 bg-amber-500/10"
  title: string;
  subtitle: string;
  howTo: Array<{ icon: React.ReactNode; text: React.ReactNode }>;
  extra?: React.ReactNode;
  onStart: () => void;
  startLabel?: string;
}) {
  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 14 }}
        className={`w-24 h-24 border rounded-3xl flex items-center justify-center mb-6 shadow-2xl ${color}`}
      >
        {icon}
      </motion.div>
      <h1 className="text-3xl font-bold mb-1">{title}</h1>
      <p className="text-zinc-400 mb-6">{subtitle}</p>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-left space-y-3 mb-5 w-full">
        <p className="uppercase tracking-widest text-[11px] font-bold text-zinc-500">Cómo se juega</p>
        {howTo.map((h, i) => (
          <div key={i} className="flex items-start gap-3 text-sm text-zinc-300">
            <span className="shrink-0 mt-0.5">{h.icon}</span>
            <span>{h.text}</span>
          </div>
        ))}
      </div>

      {extra}

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onStart}
        className="mt-2 w-24 h-24 rounded-full bg-primary text-white flex flex-col items-center justify-center shadow-2xl shadow-primary/40 hover:bg-primary-hover transition-colors"
      >
        <Play className="w-9 h-9 ml-1 fill-current" />
        <span className="text-[10px] font-bold mt-0.5">{startLabel}</span>
      </motion.button>
      </div>
    </div>
  );
}

/** Pantalla de resultados con reintento. */
export function GameResults({
  passed,
  title,
  passedTitle,
  failedTitle,
  detail,
  onContinue,
  onRetry,
  children,
  icon,
}: {
  passed: boolean;
  title?: string;
  passedTitle: string;
  failedTitle: string;
  detail: React.ReactNode;
  onContinue: () => void;
  onRetry: () => void;
  children?: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center max-w-md w-full mx-auto p-6 text-center">
      {title && <p className="uppercase tracking-widest text-xs font-bold text-zinc-500 mb-4">{title}</p>}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 14 }}
        className={`w-24 h-24 rounded-3xl border flex items-center justify-center mb-6 ${
          passed
            ? "bg-emerald-500/10 border-emerald-500/40 shadow-2xl shadow-emerald-500/20"
            : "bg-rose-500/10 border-rose-500/40"
        }`}
      >
        {icon}
      </motion.div>

      <h2 className="text-3xl font-bold mb-2">{passed ? passedTitle : failedTitle}</h2>
      <div className="text-zinc-400 mb-6">{detail}</div>

      {children}

      {passed ? (
        <button
          onClick={onContinue}
          className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
        >
          Empezar la lección
        </button>
      ) : (
        <button
          onClick={onRetry}
          className="w-full px-8 py-4 rounded-2xl font-bold text-lg bg-rose-500 text-white hover:bg-rose-400 transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-5 h-5" /> Repetir el podcast
        </button>
      )}
      </div>
    </div>
  );
}
