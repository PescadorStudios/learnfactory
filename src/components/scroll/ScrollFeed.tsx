"use client";

// Reproductor vertical estilo reels del Modo Scroll. Un corto por pantalla,
// scroll-snap por gesto, autoplay con sonido tras el primer toque. El visual
// (CueRenderer) se sincroniza al currentTime de un único <audio> imperativo
// (patrón del PodcastPlayer). Emite corto_evento: % visto, like, guardar, abrir.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Bookmark, ArrowUpRight, Volume2, VolumeX, Play, X } from "lucide-react";
import type { ScrollCorto } from "@/app/scrollActions";
import { registrarCortoEvento } from "@/app/scrollActions";
import { addScrollWatching } from "@/app/gamificationActions";
import CueRenderer, { activeCueIndex } from "./CueRenderer";
import { useSessionGate } from "@/lib/useSessionGate";
import SessionLockScreen from "@/components/gate/SessionLockScreen";
import SessionMeter from "@/components/gate/SessionMeter";
import AnonSignupWall from "@/components/gate/AnonSignupWall";
import { countAnonUnit, isAnonWalled } from "@/lib/anonGate";
import { CORTO_MIN_PCT } from "@/lib/sessionBudget";

const WATCH_FLUSH_THRESHOLD = 15; // s acumulados antes de mandar al servidor
const MAX_SANE_DELTA = 2; // ignora saltos (seeks) al contar tiempo visto

const keyOf = (c: ScrollCorto) => `${c.routeId}:${c.nodeId}`;

export default function ScrollFeed({ cortos, token }: { cortos: ScrollCorto[]; token: string | null }) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const activeRef = useRef(0);
  const maxPctRef = useRef(0);
  // Gamificación: tiempo visto (s) que aún no se ha mandado al servidor.
  const unsavedSecondsRef = useRef(0);
  const watchLastRef = useRef(0);

  const [active, setActive] = useState(0);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());

  // Muro de sesiones. Con sesión lo lleva el servidor; sin sesión, el navegador.
  const gate = useSessionGate(token);
  const [anonWalled, setAnonWalled] = useState(false);
  useEffect(() => {
    if (!token) setAnonWalled(isAnonWalled());
  }, [token]);

  // Al caer el muro se corta el audio: dejarlo sonando detrás del reloj sería
  // regalar justo lo que se acaba de bloquear.
  const blocked = Boolean(gate.state?.walled) || (!token && anonWalled);
  useEffect(() => {
    if (blocked) audioRef.current?.pause();
  }, [blocked]);

  const emit = useCallback(
    (c: ScrollCorto, fields: { pctVisto?: number; liked?: boolean; guardado?: boolean; abrirRuta?: boolean }) => {
      if (!token) return;
      registrarCortoEvento(token, { routeId: c.routeId, nodeId: c.nodeId, ...fields }).catch(() => {});
    },
    [token]
  );

  /**
   * Registra el % visto del corto que dejamos atrás. Es también el punto donde se
   * cobra la unidad del muro: solo cuenta si de verdad se vio (CORTO_MIN_PCT),
   * nunca por un like o un guardado.
   */
  const flushView = useCallback(
    (index: number) => {
      const c = cortos[index];
      if (!c || maxPctRef.current <= 0) return;
      const pct = maxPctRef.current;

      if (token) {
        // El servidor decide y devuelve el estado del muro ya actualizado.
        registrarCortoEvento(token, { routeId: c.routeId, nodeId: c.nodeId, pctVisto: pct })
          .then(r => gate.apply(r.gate))
          .catch(() => {});
      } else if (pct >= CORTO_MIN_PCT) {
        // Sin cuenta: lo lleva el navegador (deduplicado por corto).
        countAnonUnit(keyOf(c));
        setAnonWalled(isAnonWalled());
      }
    },
    [cortos, token, gate]
  );

  /** Manda al servidor el tiempo visto acumulado (medidor global del usuario). */
  const flushWatch = useCallback(() => {
    const secs = Math.floor(unsavedSecondsRef.current);
    if (secs <= 0 || !token) return;
    unsavedSecondsRef.current -= secs; // conserva el resto fraccional
    addScrollWatching(token, secs).catch(() => {});
  }, [token]);

  // Detectar el corto activo por intersección.
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            setActive(Number((e.target as HTMLElement).dataset.idx));
          }
        }
      },
      { threshold: [0.6] }
    );
    slideRefs.current.forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  }, [cortos.length]);

  // Cambio de corto activo: flush del anterior + cargar y reproducir audio.
  useEffect(() => {
    const prev = activeRef.current;
    if (prev !== active) {
      flushView(prev);
      maxPctRef.current = 0;
    }
    activeRef.current = active;
    setCurrentMs(0);
    watchLastRef.current = 0;

    const a = audioRef.current;
    const c = cortos[active];
    if (!a || !c) return;
    a.src = c.audioUrl;
    a.currentTime = 0;
    a.muted = muted;
    if (started) a.play().catch(() => {});
    // `muted` se aplica en su propio efecto para no recargar el audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, started, cortos]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // Bucle de sincronización: currentMs + máximo % visto.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = audioRef.current;
      const c = cortos[active];
      if (a && c) {
        const t = a.currentTime;
        setCurrentMs(t * 1000);
        if (c.durationSeconds > 0) {
          const pct = Math.min(100, (t / c.durationSeconds) * 100);
          if (pct > maxPctRef.current) maxPctRef.current = pct;
        }
        // Tiempo visto: solo el avance normal del audio (ignora seeks/saltos).
        if (!a.paused) {
          const delta = t - watchLastRef.current;
          if (delta > 0 && delta <= MAX_SANE_DELTA) {
            unsavedSecondsRef.current += delta;
            if (unsavedSecondsRef.current >= WATCH_FLUSH_THRESHOLD) flushWatch();
          }
        }
        watchLastRef.current = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, cortos, flushWatch]);

  // Al terminar el audio, avanzar al siguiente corto.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => slideRefs.current[activeRef.current + 1]?.scrollIntoView({ behavior: "smooth" });
    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
  }, []);

  // Flush (% visto + tiempo visto) al ocultar/cerrar la pestaña o desmontar.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") { flushView(activeRef.current); flushWatch(); } };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushWatch);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushWatch);
      flushView(activeRef.current);
      flushWatch();
    };
  }, [flushView, flushWatch]);

  const start = () => {
    setStarted(true);
    setMuted(false);
    const a = audioRef.current;
    if (a) {
      a.muted = false;
      a.play().catch(() => {});
    }
  };

  const toggleLike = (c: ScrollCorto) => {
    const k = keyOf(c);
    setLiked(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else { n.add(k); emit(c, { liked: true }); }
      return n;
    });
  };
  const toggleSave = (c: ScrollCorto) => {
    const k = keyOf(c);
    setSaved(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else { n.add(k); emit(c, { guardado: true }); }
      return n;
    });
  };
  const openRoute = (c: ScrollCorto) => {
    emit(c, { abrirRuta: true });
    router.push(`/route/${c.routeId}`);
  };

  return (
    <div
      className="relative h-[100dvh] w-full overflow-y-scroll snap-y snap-mandatory bg-black text-white"
      style={{ scrollbarWidth: "none" }}
    >
      <audio ref={audioRef} preload="auto" playsInline />

      {/* Cerrar */}
      <button
        onClick={() => router.push("/")}
        className="fixed top-4 left-4 z-30 w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white/80 hover:text-white"
        aria-label="Cerrar"
      >
        <X className="w-5 h-5" />
      </button>
      {/* Silenciar */}
      <button
        onClick={() => setMuted(m => !m)}
        className="fixed top-4 right-4 z-30 w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white/80 hover:text-white"
        aria-label={muted ? "Activar sonido" : "Silenciar"}
      >
        {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>

      {cortos.map((c, i) => {
        const isActive = i === active;
        const k = keyOf(c);
        const cueIdx = isActive ? activeCueIndex(c.timeline.cues, currentMs) : 0;
        const progress = c.durationSeconds > 0 && isActive ? Math.min(100, (currentMs / (c.durationSeconds * 1000)) * 100) : 0;
        return (
          <section
            key={k}
            data-idx={i}
            ref={el => { slideRefs.current[i] = el; }}
            className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden"
          >
            {/* Fondo: portada difuminada de la ruta */}
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-black to-zinc-950" />
            {c.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-15 blur-2xl scale-110" />
            )}

            {/* Columna central 9:16 */}
            <div className="relative mx-auto w-full max-w-[460px] h-full">
              {isActive ? (
                <CueRenderer cues={c.timeline.cues} currentTimeMs={currentMs} />
              ) : (
                <div className="absolute inset-0 flex flex-col justify-center px-7">
                  <p className="text-fuchsia-400 text-xs font-bold uppercase tracking-[0.2em] mb-3">{c.topic}</p>
                  <h2 className="text-4xl font-black leading-tight text-white/90">{c.title}</h2>
                </div>
              )}

              {/* Barra de progreso del corto activo */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-white/10">
                  <div className="h-full bg-fuchsia-500" style={{ width: `${progress}%` }} />
                </div>
              )}

              {/* Acciones (derecha) */}
              <div className="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-5">
                <button onClick={() => toggleLike(c)} className="flex flex-col items-center gap-1" aria-label="Me gusta">
                  <span className={`w-12 h-12 rounded-full flex items-center justify-center ${liked.has(k) ? "bg-rose-500/20 text-rose-400" : "bg-white/10 text-white"}`}>
                    <Heart className={`w-6 h-6 ${liked.has(k) ? "fill-current" : ""}`} />
                  </span>
                </button>
                <button onClick={() => toggleSave(c)} className="flex flex-col items-center gap-1" aria-label="Guardar">
                  <span className={`w-12 h-12 rounded-full flex items-center justify-center ${saved.has(k) ? "bg-amber-500/20 text-amber-400" : "bg-white/10 text-white"}`}>
                    <Bookmark className={`w-6 h-6 ${saved.has(k) ? "fill-current" : ""}`} />
                  </span>
                </button>
                <button onClick={() => openRoute(c)} className="flex flex-col items-center gap-1" aria-label="Abrir ruta">
                  <span className="w-12 h-12 rounded-full bg-white/10 text-white flex items-center justify-center">
                    <ArrowUpRight className="w-6 h-6" />
                  </span>
                  <span className="text-[10px] text-white/70">Ruta</span>
                </button>
              </div>

              {/* Pie: tema + título */}
              <div className="absolute left-5 right-20 bottom-10 z-10">
                <button onClick={() => openRoute(c)} className="text-left">
                  <p className="text-fuchsia-300 text-xs font-bold uppercase tracking-widest mb-1">{c.topic}</p>
                  <p className="text-base font-bold text-white/90 line-clamp-2">{c.title}</p>
                </button>
              </div>
            </div>

            {/* Cue index oculto para accesibilidad/depuración */}
            <span className="sr-only">{cueIdx}</span>
          </section>
        );
      })}

      {/* Medidor de la sesión, flotando sobre el feed */}
      {gate.state && !gate.state.unlimited && !gate.state.walled && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 bg-black/60 backdrop-blur-sm rounded-2xl px-4 py-2 pointer-events-none">
          <SessionMeter gate={gate.state} />
        </div>
      )}

      {/* Muro de sesiones: z-50 para quedar POR ENCIMA del gate de arranque (z-40). */}
      {gate.state?.walled && <SessionLockScreen gate={gate.state} onElapsed={gate.refresh} />}

      {/* Visitante sin cuenta que ya gastó sus unidades de prueba */}
      {!token && anonWalled && <AnonSignupWall />}

      {/* Gate de inicio: el navegador bloquea el autoplay con sonido hasta el 1er gesto */}
      {!started && (
        <button
          onClick={start}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm text-white"
        >
          <span className="w-20 h-20 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/50 flex items-center justify-center mb-4">
            <Play className="w-9 h-9 fill-current ml-1" />
          </span>
          <span className="text-lg font-bold">Toca para empezar</span>
          <span className="text-sm text-white/60 mt-1">Desliza hacia arriba para el siguiente</span>
        </button>
      )}
    </div>
  );
}
