"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Play, Pause, SkipBack, SkipForward, Headphones, ListMusic, Trophy } from "lucide-react";
import { usePlaybackRate } from "@/app/lesson/attention/usePlaybackRate";
import { addPodcastListening, getListeningStats } from "@/app/gamificationActions";
import { levelFor, PODCAST_LEVELS, formatListened, type LevelDef } from "@/lib/listeningLevels";
import type { PodcastTrack } from "./types";

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function srcFor(t: PodcastTrack): string {
  return `${t.audioUrl}${t.audioUrl.includes("?") ? "&" : "?"}v=${t.durationSeconds}`;
}

/** Color de texto por tier del nivel (coherente con la reputación). */
const TIER_TEXT: Record<LevelDef["tier"], string> = {
  zinc: "text-zinc-300",
  bronze: "text-amber-600",
  silver: "text-zinc-200",
  gold: "text-amber-400",
  legend: "text-violet-300",
};

/** Suma del tiempo de medios que NO debe contarse como escucha (saltos/seeks). */
const MAX_SANE_DELTA = 2; // s entre dos timeupdate consecutivos
/** Segundos acumulados sin guardar tras los cuales se vacía al servidor. */
const FLUSH_THRESHOLD = 30;

export default function PodcastPlayer({
  queue,
  token,
  onExit,
}: {
  queue: PodcastTrack[];
  token: string;
  onExit: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const queueRef = useRef(queue);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Velocidad 1× / 1.5× / 2× (reaplica al cambiar de pista, mantiene tono natural).
  const { rate, cycle } = usePlaybackRate(audioRef);

  // Gamificación de escucha (nivel global por usuario).
  const [podcastSeconds, setPodcastSeconds] = useState(0);
  const [levelUp, setLevelUp] = useState<LevelDef | null>(null);
  const podcastSecondsRef = useRef(0);
  const unsavedRef = useRef(0); // tiempo de medios escuchado pendiente de guardar
  const lastTimeRef = useRef(0); // último currentTime visto (para el delta)

  useEffect(() => { queueRef.current = queue; }, [queue]);

  const current = queue[index];
  const hasNext = index < queue.length - 1;
  const hasPrev = index > 0;

  // ── Reproducción imperativa: cambiar de pista NO pasa por un re-render de React.
  //    Reusamos el MISMO <audio> y fijamos src + play() de forma síncrona. iOS lo
  //    trata como continuación de la reproducción → permite el avance con la
  //    pantalla bloqueada (la raíz del fallo era el ciclo onEnded→setState→render).
  const updateMetadata = useCallback((i: number) => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const t = queueRef.current[i];
    if (!t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.routeTopic,
        album: "Learn Factory · Podcast",
      });
    } catch {
      /* MediaSession no disponible */
    }
  }, []);

  const playIndex = useCallback((i: number) => {
    const a = audioRef.current;
    const q = queueRef.current;
    if (!a || i < 0 || i >= q.length) return;
    indexRef.current = i;
    setIndex(i);
    lastTimeRef.current = 0;
    setCurrentTime(0);
    a.src = srcFor(q[i]);
    updateMetadata(i);
    a.play().catch(() => setIsPlaying(false));
  }, [updateMetadata]);

  // Vaciado del tiempo escuchado al servidor (acumula nivel global).
  const flush = useCallback(async () => {
    const secs = Math.floor(unsavedRef.current);
    if (secs <= 0 || !token) return;
    unsavedRef.current -= secs; // conserva el resto fraccional
    const prevLevel = levelFor(podcastSecondsRef.current, PODCAST_LEVELS).current.level;
    const { totalSeconds } = await addPodcastListening(token, secs);
    podcastSecondsRef.current = totalSeconds;
    setPodcastSeconds(totalSeconds);
    const reached = levelFor(totalSeconds, PODCAST_LEVELS).current;
    if (reached.level > prevLevel) setLevelUp(reached);
  }, [token]);

  // Semilla del total acumulado (para pintar el nivel correcto al entrar).
  useEffect(() => {
    if (!token) return;
    getListeningStats(token).then(({ podcastSeconds: s }) => {
      podcastSecondsRef.current = s;
      setPodcastSeconds(s);
    });
  }, [token]);

  // Arranque: fija la primera pista de forma imperativa (hay gesto del usuario en
  // la pila, desde el lobby) y conecta los listeners NATIVOS del <audio>.
  useEffect(() => {
    playIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listener nativo `ended`: avanza síncronamente (clave para iOS en background).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => {
      const i = indexRef.current;
      if (i < queueRef.current.length - 1) playIndex(i + 1);
      else setIsPlaying(false);
      flush(); // fire-and-forget; el avance ya ocurrió síncronamente arriba
    };
    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
  }, [playIndex, flush]);

  // MediaSession: controles de la pantalla de bloqueo / auriculares. Se registran
  // una sola vez; los handlers leen el índice vivo desde los refs.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler("play", () => audioRef.current?.play());
      ms.setActionHandler("pause", () => audioRef.current?.pause());
      ms.setActionHandler("previoustrack", () => playIndex(indexRef.current - 1));
      ms.setActionHandler("nexttrack", () => playIndex(indexRef.current + 1));
    } catch {
      /* MediaSession no disponible */
    }
    return () => {
      try {
        ms.setActionHandler("play", null);
        ms.setActionHandler("pause", null);
        ms.setActionHandler("previoustrack", null);
        ms.setActionHandler("nexttrack", null);
      } catch { /* noop */ }
    };
  }, [playIndex]);

  // Vaciar el tiempo escuchado al ocultar/cerrar (iOS al bloquear) o desmontar.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  const goNext = useCallback(() => playIndex(indexRef.current + 1), [playIndex]);
  const goPrev = useCallback(() => playIndex(indexRef.current - 1), [playIndex]);

  const onTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const t = e.currentTarget.currentTime;
    const delta = t - lastTimeRef.current;
    // Cuenta como escucha solo el avance "normal" del tiempo de medios (ignora
    // saltos hacia atrás y seeks largos hacia adelante).
    if (delta > 0 && delta <= MAX_SANE_DELTA) {
      unsavedRef.current += delta;
      if (unsavedRef.current >= FLUSH_THRESHOLD) flush();
    }
    lastTimeRef.current = t;
    setCurrentTime(t);
    if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({ duration, position: t, playbackRate: rate });
      } catch { /* setPositionState no soportado */ }
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    lastTimeRef.current = frac * duration; // no contar el salto como escucha
    a.currentTime = frac * duration;
  };

  if (!current) return null;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const lvl = levelFor(podcastSeconds, PODCAST_LEVELS);

  return (
    <main className="h-[100dvh] bg-zinc-950 text-white flex flex-col">
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => { setIsPlaying(true); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; }}
        onPause={() => { setIsPlaying(false); flush(); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; }}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />

      {/* Cabecera */}
      <header className="flex items-center justify-between p-4 md:p-6 max-w-2xl w-full mx-auto">
        <button onClick={onExit} className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" /> Salir
        </button>
        <span className="text-xs text-zinc-500">{index + 1} / {queue.length}</span>
      </header>

      {/* Now playing */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center min-h-0">
        <div className="w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-primary/30 to-secondary/20 border border-primary/30 flex items-center justify-center mb-8">
          <Headphones className="w-12 h-12 md:w-16 md:h-16 text-primary" />
        </div>
        <p className="uppercase tracking-widest text-xs font-bold text-primary mb-2">{current.routeTopic}</p>
        <h1 className="text-2xl md:text-3xl font-bold leading-snug max-w-lg">{current.title}</h1>
      </div>

      {/* Nivel de escucha (gamificación) */}
      <div className="max-w-2xl w-full mx-auto px-6 mb-3">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className={`inline-flex items-center gap-1.5 font-bold ${TIER_TEXT[lvl.current.tier]}`}>
            <Trophy className="w-3.5 h-3.5" /> Nivel {lvl.current.level} · {lvl.current.name}
          </span>
          <span className="text-zinc-500 tabular-nums">{formatListened(podcastSeconds)} escuchados</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-accent rounded-full" style={{ width: `${lvl.progressPct}%` }} />
        </div>
      </div>

      {/* Controles */}
      <div className="max-w-2xl w-full mx-auto px-6 pb-6">
        {/* Progreso */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">{fmtTime(currentTime)}</span>
          <div onClick={seek} className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden cursor-pointer">
            <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-zinc-500 tabular-nums w-10">{fmtTime(duration)}</span>
        </div>

        {/* Botones */}
        <div className="relative flex items-center justify-center gap-8">
          <button onClick={goPrev} disabled={!hasPrev} className="text-zinc-300 hover:text-white disabled:opacity-30 transition-colors">
            <SkipBack className="w-7 h-7 fill-current" />
          </button>
          <button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/30 hover:bg-primary-hover transition-colors"
          >
            {isPlaying ? <Pause className="w-7 h-7 fill-current" /> : <Play className="w-7 h-7 ml-1 fill-current" />}
          </button>
          <button onClick={goNext} disabled={!hasNext} className="text-zinc-300 hover:text-white disabled:opacity-30 transition-colors">
            <SkipForward className="w-7 h-7 fill-current" />
          </button>

          {/* Velocidad (1× / 1.5× / 2×) */}
          <button
            onClick={cycle}
            aria-label={`Velocidad ${rate}×. Tocar para cambiar.`}
            title="Velocidad de reproducción"
            className={`absolute right-0 h-10 min-w-[3.25rem] px-3 rounded-full border text-sm font-bold tabular-nums transition-colors ${
              rate === 1
                ? "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-primary"
                : "bg-primary/15 border-primary text-primary"
            }`}
          >
            {rate}×
          </button>
        </div>
      </div>

      {/* Playlist */}
      <div className="border-t border-zinc-800 max-h-[34vh] overflow-y-auto">
        <div className="max-w-2xl w-full mx-auto px-4 py-3">
          <p className="flex items-center gap-2 text-xs uppercase tracking-widest font-bold text-zinc-500 mb-2 px-1">
            <ListMusic className="w-3.5 h-3.5" /> En cola · {queue.length}
          </p>
          <ul className="space-y-1">
            {queue.map((t, i) => {
              const active = i === index;
              return (
                <li key={`${t.routeId}::${t.nodeId}::${i}`}>
                  <button
                    onClick={() => playIndex(i)}
                    className={`w-full flex items-center gap-3 text-left rounded-xl px-3 py-2 transition-colors ${
                      active ? "bg-primary/15" : "hover:bg-zinc-900"
                    }`}
                  >
                    <span className={`shrink-0 w-6 text-center text-xs tabular-nums ${active ? "text-primary font-bold" : "text-zinc-600"}`}>
                      {active && isPlaying ? "▶" : i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm truncate ${active ? "text-white font-semibold" : "text-zinc-300"}`}>{t.title}</span>
                      <span className="block text-xs text-zinc-600 truncate">{t.routeTopic}</span>
                    </span>
                    <span className="shrink-0 text-xs text-zinc-600 tabular-nums">{fmtTime(t.durationSeconds)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* 🎧 Subida de nivel de escucha */}
      <AnimatePresence>
        {levelUp && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setLevelUp(null)}>
            <motion.div
              initial={{ scale: 0.7, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 18 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-900 rounded-3xl p-8 w-full max-w-sm text-center border border-primary/50 shadow-[0_0_50px_rgba(99,102,241,0.3)]"
            >
              <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-primary/15 border-2 border-primary/60 flex items-center justify-center">
                <Trophy className={`w-10 h-10 ${TIER_TEXT[levelUp.tier]}`} />
              </div>
              <p className="text-xs uppercase tracking-widest font-bold mb-1 text-primary">¡Subiste de nivel escuchando!</p>
              <h3 className="text-3xl font-bold mb-2">Nivel {levelUp.level} · {levelUp.name}</h3>
              <p className="text-zinc-400 text-sm mb-6">Cada minuto en modo podcast suma. Sigue escuchando para llegar más lejos.</p>
              <button onClick={() => setLevelUp(null)} className="w-full py-3 rounded-2xl font-bold text-white bg-primary hover:bg-primary-hover transition-all">
                Seguir escuchando
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
