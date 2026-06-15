"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Play, Pause, SkipBack, SkipForward, Headphones, ListMusic } from "lucide-react";
import { usePlaybackRate } from "@/app/lesson/attention/usePlaybackRate";
import type { PodcastTrack } from "./types";

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function srcFor(t: PodcastTrack): string {
  return `${t.audioUrl}${t.audioUrl.includes("?") ? "&" : "?"}v=${t.durationSeconds}`;
}

export default function PodcastPlayer({
  queue,
  onExit,
}: {
  queue: PodcastTrack[];
  onExit: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Velocidad 1× / 1.5× / 2× (reaplica al cambiar de pista, mantiene tono natural).
  const { rate, cycle } = usePlaybackRate(audioRef);

  const current = queue[index];
  const hasNext = index < queue.length - 1;
  const hasPrev = index > 0;

  const goNext = useCallback(() => setIndex((i) => (i < queue.length - 1 ? i + 1 : i)), [queue.length]);
  const goPrev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), []);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  // Al cambiar de pista, reproduce automáticamente (auto-avance). El reseteo del
  // tiempo lo hace el evento onLoadStart del <audio> al cambiar de src.
  useEffect(() => {
    audioRef.current?.play().catch(() => setIsPlaying(false));
  }, [index]);

  // MediaSession: controles desde la pantalla de bloqueo / auriculares (manejar,
  // dormir). Degrada con elegancia si el navegador no lo soporta.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !current) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.routeTopic,
        album: "Learn Factory · Podcast",
      });
      navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler("previoustrack", hasPrev ? goPrev : null);
      navigator.mediaSession.setActionHandler("nexttrack", hasNext ? goNext : null);
    } catch {
      /* MediaSession no disponible */
    }
  }, [current, hasPrev, hasNext, goPrev, goNext]);

  const onEnded = () => {
    if (hasNext) goNext();
    else setIsPlaying(false);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = frac * duration;
  };

  if (!current) return null;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <main className="h-[100dvh] bg-zinc-950 text-white flex flex-col">
      <audio
        ref={audioRef}
        src={srcFor(current)}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onLoadStart={() => setCurrentTime(0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={onEnded}
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
                    onClick={() => setIndex(i)}
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
    </main>
  );
}
