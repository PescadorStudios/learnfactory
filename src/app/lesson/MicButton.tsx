"use client";

import { Mic, MicOff } from "lucide-react";
import { useSpeechToText } from "@/lib/useSpeechToText";

interface MicButtonProps {
  onTranscript: (chunk: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function MicButton({
  onTranscript,
  disabled = false,
  className = "",
}: MicButtonProps) {
  const { supported, listening, interimTranscript, error, toggle } =
    useSpeechToText({ onResult: onTranscript });

  // On browsers without the Web Speech API (e.g. Firefox) we hide the button
  // entirely so users simply type as before.
  if (!supported) return null;

  const title = listening ? "Detener dictado" : "Dictar por voz";

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-pressed={listening}
        className={`relative shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
          listening
            ? "bg-rose-500 text-white ring-2 ring-rose-400/60 animate-pulse"
            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        }`}
      >
        {listening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>
      {listening && (
        <span className="max-w-[220px] truncate text-[11px] text-rose-300/80">
          {interimTranscript || "Escuchando…"}
        </span>
      )}
      {error && !listening && (
        <span className="max-w-[220px] truncate text-[11px] text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}
