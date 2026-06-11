"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, Ear, AlertTriangle, Fingerprint, PartyPopper, ShieldCheck } from "lucide-react";
import type { SubtitlesData } from "@/lib/types";
import { AudioControls, GameHeader, GameBriefing, GameResults } from "./shared";

interface Props {
  nodeTitle: string;
  audioBlob: Blob;
  data: SubtitlesData;
  durationSeconds: number;
  onFinish: (correct: number, total: number) => void;
  onExit: () => void;
}

type Phase = "briefing" | "playing" | "results";
type Flash = { kind: "hit" | "miss"; id: number } | null;

// Margen para reaccionar a una trampa que acaba de salir de pantalla
const GRACE_SECONDS = 1.5;

/**
 * MECÁNICA 2 — SUBTÍTULOS TRAMPA
 * Los subtítulos acompañan al audio, pero N de ellos contradicen lo narrado.
 * El detector debe tocar el subtítulo en el momento de la discrepancia.
 */
export default function SubtitleGame({ nodeTitle, audioBlob, data, durationSeconds, onFinish, onExit }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("briefing");
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [caught, setCaught] = useState<Set<number>>(new Set());
  const [falseTaps, setFalseTaps] = useState(0);
  const [flash, setFlash] = useState<Flash>(null);

  const audioUrl = useMemo(() => URL.createObjectURL(audioBlob), [audioBlob]);
  useEffect(() => () => URL.revokeObjectURL(audioUrl), [audioUrl]);

  const trampas = data.trampas;
  const passCount = Math.ceil(trampas * 0.75); // 12 → 9
  const maxScans = trampas + 5;
  const scansUsed = caught.size + falseTaps;
  const scansLeft = Math.max(0, maxScans - scansUsed);
  const passed = caught.size >= passCount;

  // Reloj anclado al audio
  useEffect(() => {
    if (phase !== "playing") return;
    const tick = () => {
      const a = audioRef.current;
      if (a) setCurrentTime(a.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  // Cue visible: el último cuyo inicio ya pasó
  const currentIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < data.cues.length; i++) {
      if (data.cues[i].atSeconds <= currentTime) idx = i;
      else break;
    }
    return idx;
  }, [data.cues, currentTime]);

  const startPlaying = () => {
    setPhase("playing");
    setIsPaused(false);
    const a = audioRef.current;
    if (a) {
      a.currentTime = 0;
      a.play();
    }
  };

  const togglePause = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setIsPaused(false); }
    else { a.pause(); setIsPaused(true); }
  };

  const handleScan = useCallback(() => {
    if (phase !== "playing" || scansLeft <= 0 || isPaused) return;

    // Evaluar el cue visible; si no, el anterior dentro del margen de reacción
    const tryCatch = (idx: number): boolean => {
      if (idx < 0) return false;
      const cue = data.cues[idx];
      if (cue.alterado && !caught.has(idx)) {
        setCaught(prev => new Set(prev).add(idx));
        return true;
      }
      return false;
    };

    let hit = tryCatch(currentIndex);
    if (!hit && currentIndex > 0) {
      const prev = data.cues[currentIndex - 1];
      if (currentTime - prev.endSeconds < GRACE_SECONDS) hit = tryCatch(currentIndex - 1);
    }
    if (!hit) setFalseTaps(f => f + 1);

    setFlash({ kind: hit ? "hit" : "miss", id: Date.now() });
    setTimeout(() => setFlash(null), 700);
  }, [phase, scansLeft, isPaused, currentIndex, currentTime, data.cues, caught]);

  const handleRetry = () => {
    setCaught(new Set());
    setFalseTaps(0);
    setFlash(null);
    setCurrentTime(0);
    startPlaying();
  };

  const missedTrampas = data.cues
    .map((c, i) => ({ ...c, i }))
    .filter(c => c.alterado && !caught.has(c.i));

  const currentCue = currentIndex >= 0 ? data.cues[currentIndex] : null;

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col overflow-hidden">
      <audio ref={audioRef} src={audioUrl} onEnded={() => setPhase("results")} preload="auto" />
      <GameHeader onExit={onExit} />

      {phase === "briefing" && (
        <GameBriefing
          icon={<ScanLine className="w-12 h-12 text-amber-400" />}
          color="bg-amber-500/10 border-amber-500/30 shadow-amber-500/20"
          title="Subtítulos Trampa"
          subtitle={nodeTitle}
          howTo={[
            { icon: <Ear className="w-4 h-4 text-primary" />, text: <>Escucha el podcast leyendo los subtítulos: <b>casi siempre coinciden</b> con la voz.</> },
            { icon: <AlertTriangle className="w-4 h-4 text-amber-400" />, text: <>Pero <b>{trampas} subtítulos son trampa</b>: dicen algo distinto a lo que OYES (una cifra, una causa, un orden...).</> },
            { icon: <Fingerprint className="w-4 h-4 text-rose-400" />, text: <><b>Toca el subtítulo</b> en el momento en que detectes la discrepancia. Tienes {maxScans} escaneos: no los gastes a lo loco.</> },
            { icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />, text: <>Caza <b>{passCount} de {trampas}</b> trampas para avanzar. Solo leyendo no se ven: hay que escuchar.</> },
          ]}
          onStart={startPlaying}
          startLabel="Detectar"
        />
      )}

      {phase === "playing" && (
        <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto p-6">
          {/* HUD */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Trampas: {caught.size}/{trampas}
            </span>
            <span className={`text-xs font-bold flex items-center gap-1.5 rounded-full px-3 py-1.5 border ${
              scansLeft <= 3 ? "text-rose-400 bg-rose-500/10 border-rose-500/30" : "text-zinc-300 bg-zinc-900 border-zinc-800"
            }`}>
              <ScanLine className="w-3.5 h-3.5" /> Escaneos: {scansLeft}
            </span>
          </div>

          {/* Subtítulo gigante (tocable) */}
          <div className="flex-1 flex items-center justify-center relative">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleScan}
              disabled={scansLeft <= 0}
              className={`relative w-full min-h-[180px] rounded-3xl border-2 p-8 flex items-center justify-center transition-colors ${
                flash?.kind === "hit" ? "border-emerald-500 bg-emerald-500/10" :
                flash?.kind === "miss" ? "border-rose-500 bg-rose-500/10" :
                "border-zinc-700 bg-zinc-900 hover:border-amber-500/60"
              }`}
            >
              <AnimatePresence mode="wait">
                <motion.p
                  key={currentIndex}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                  className="text-2xl md:text-3xl font-semibold leading-snug text-zinc-100"
                >
                  {currentCue ? currentCue.texto : "..."}
                </motion.p>
              </AnimatePresence>

              {/* Feedback del escaneo */}
              <AnimatePresence>
                {flash && (
                  <motion.span
                    key={flash.id}
                    initial={{ opacity: 0, scale: 0.6, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-sm font-bold ${
                      flash.kind === "hit" ? "bg-emerald-500 text-emerald-950" : "bg-rose-500 text-white"
                    }`}
                  >
                    {flash.kind === "hit" ? "¡Trampa detectada!" : "Escaneo fallido"}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </div>

          <p className="text-center text-xs text-zinc-600 mt-3">
            Toca el subtítulo cuando NO coincida con lo que oyes
          </p>

          <AudioControls
            currentTime={currentTime}
            duration={durationSeconds}
            isPaused={isPaused}
            onTogglePause={togglePause}
          />
        </div>
      )}

      {phase === "results" && (
        <GameResults
          passed={passed}
          title="Subtítulos Trampa"
          passedTitle="¡Detector implacable!"
          failedTitle="Se te escaparon..."
          icon={passed ? <PartyPopper className="w-12 h-12 text-emerald-400" /> : <ScanLine className="w-12 h-12 text-rose-400" />}
          detail={
            <p>
              Cazaste <span className={`font-bold ${passed ? "text-emerald-400" : "text-rose-400"}`}>{caught.size}</span> de {trampas} trampas
              {falseTaps > 0 ? ` · ${falseTaps} escaneos fallidos` : ""}
              {passed ? "" : ` · necesitas ${passCount}`}
            </p>
          }
          onContinue={() => onFinish(caught.size, trampas)}
          onRetry={handleRetry}
        >
          {!passed && missedTrampas.length > 0 && (
            <div className="w-full mb-6 space-y-2 max-h-44 overflow-y-auto text-left">
              <p className="uppercase tracking-widest text-[11px] font-bold text-zinc-500 text-center">Trampas que no viste</p>
              {missedTrampas.slice(0, 4).map(t => (
                <div key={t.i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs">
                  <p className="text-rose-400 line-through">{t.texto}</p>
                  <p className="text-emerald-400 mt-1">El audio decía: {t.original}</p>
                </div>
              ))}
            </div>
          )}
        </GameResults>
      )}
    </main>
  );
}
