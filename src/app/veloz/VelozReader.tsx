"use client";

// El lector RSVP a pantalla completa.
//
// Decisiones que no son obvias:
//
// · El reloj es un bucle de requestAnimationFrame contra performance.now(), no
//   un setInterval: a 500 ppm un setInterval deriva visiblemente y el navegador
//   lo estrangula al ocultar la pestaña. El índice de chunk vive en un ref y
//   solo hay UN setState por chunk.
// · El bucle se re-agenda a través de `loopRef`, no llamándose a sí mismo: si se
//   auto-referenciara, la cadena de rAF seguiría ejecutando la closure de la
//   primera vuelta y trabajaría con un `charge` y un `flush` obsoletos.
// · El estado es la PALABRA, no el chunk. Así, cambiar de 1 a 3 palabras por
//   golpe re-deriva el chunk sin mover al lector de sitio, y es lo mismo que se
//   persiste en cursor_word.
// · Cambiar la velocidad NO vuelve a tokenizar: el peso de cada chunk ya viene
//   calculado desde buildChunks, así que el slider responde al instante incluso
//   con un libro entero cargado.
// · Solo se cobra la sección donde se REANUDA la reproducción y las que se
//   cruzan leyendo. Arrastrar la barra no cobra: saltar de la sección 1 a la 8
//   no puede costar siete unidades.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Eye,
  Keyboard,
  Minus,
  Pause,
  Play,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import SessionLockScreen from "@/components/gate/SessionLockScreen";
import SessionMeter from "@/components/gate/SessionMeter";
import type { SessionGate } from "@/lib/useSessionGate";
import type { ReadingDoc, ReadingPrefs } from "@/lib/types";
import {
  WPM_MAX,
  WPM_MIN,
  WPM_PRESETS,
  WPM_STEP,
  buildChunks,
  chunkDurationMs,
  chunkIndexForWord,
  estimateMinutes,
  nextSentenceWord,
  normalizeText,
  previousSentenceWord,
  sectionCount,
  sectionOf,
  tokenizeWords,
} from "@/lib/rsvp";
import { saveReadingPrefs, saveReadingProgress, startReadingSection } from "@/app/velozActions";
import OrpWord from "./OrpWord";

/** Cada cuánto se vacía el progreso al servidor mientras se lee. */
const SAVE_EVERY_MS = 10_000;
/** Tras cuánto quieto se esconden los controles (el ojo va en el pivote). */
const HIDE_CONTROLS_MS = 3000;

export const cursorKey = (docId: string) => `lf_veloz_cursor_${docId}`;

export default function VelozReader({
  doc,
  prefs: initialPrefs,
  initialWord,
  token,
  gate,
  onExit,
}: {
  doc: ReadingDoc;
  prefs: ReadingPrefs;
  /** Palabra por la que arrancar (ya reconciliada con el espejo local). */
  initialWord: number;
  token: string;
  gate: SessionGate;
  onExit: () => void;
}) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [playing, setPlaying] = useState(false);
  const [word, setWord] = useState(initialWord);
  const [autoHidden, setAutoHidden] = useState(false);
  const [panel, setPanel] = useState<null | "ajustes" | "atajos" | "texto" | "descanso">(null);
  const [needsWarning, setNeedsWarning] = useState(!initialPrefs.warningAckAt);

  const words = useMemo(() => tokenizeWords(normalizeText(doc.content)), [doc.content]);
  const chunks = useMemo(
    () =>
      buildChunks(words, {
        chunkSize: prefs.chunkSize,
        dynamicPauses: prefs.dynamicPauses,
        longWordBoost: prefs.longWordBoost,
      }),
    [words, prefs.chunkSize, prefs.dynamicPauses, prefs.longWordBoost]
  );

  const total = words.length;
  const sections = sectionCount(total);
  const idx = useMemo(() => chunkIndexForWord(chunks, word), [chunks, word]);
  const current = chunks[idx];
  const section = sectionOf(word);
  // Los controles reaparecen al pausar o al abrir un panel, sin tocar estado.
  const showControls = !playing || panel !== null || !autoHidden;

  // ── Refs del bucle (el estado de React va demasiado lento para 10 Hz) ─────
  const idxRef = useRef(idx);
  const wordRef = useRef(word);
  const chunksRef = useRef(chunks);
  const wpmRef = useRef(prefs.wpm);
  const nextAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  // Secciones ya cobradas en esta sesión de lectura: evita repetir el viaje al
  // servidor (la idempotencia de study_units cubre el resto, StrictMode incluido).
  const chargedRef = useRef<Set<number>>(new Set());
  const unsavedSecondsRef = useRef(0);
  const lastSaveRef = useRef(0);
  const lastFrameRef = useRef(0);
  const breakSecondsRef = useRef(0);
  const prefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El ref del chunk se re-deriva de la PALABRA, así que cambiar el tamaño de
  // chunk a media lectura no desplaza el cursor.
  useEffect(() => {
    chunksRef.current = chunks;
    idxRef.current = chunkIndexForWord(chunks, wordRef.current);
  }, [chunks]);

  useEffect(() => {
    wordRef.current = word;
  }, [word]);

  useEffect(() => {
    wpmRef.current = prefs.wpm;
  }, [prefs.wpm]);

  /** Detiene el bucle. */
  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  // ── Persistencia del progreso ────────────────────────────────────────────
  const flush = useCallback(
    (force = false) => {
      const w = chunksRef.current[idxRef.current]?.wordIndex ?? 0;
      try {
        localStorage.setItem(cursorKey(doc.id), String(w));
      } catch {
        /* sin storage: el servidor sigue siendo la fuente de verdad */
      }
      const secs = unsavedSecondsRef.current;
      unsavedSecondsRef.current = 0;
      lastSaveRef.current = performance.now();
      void saveReadingProgress(token, doc.id, w, secs, force);
    },
    [doc.id, token]
  );

  useEffect(() => {
    // Al ocultarse la pestaña se PAUSA explícitamente: el rAF se detendría solo,
    // pero al volver dispararía una ráfaga de chunks acumulados.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        flush();
      }
    };
    // pagehide y no beforeunload: en móvil beforeunload apenas se dispara.
    const onPageHide = () => flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      flush();
    };
  }, [flush, stop]);

  // ── Cobro de secciones ───────────────────────────────────────────────────
  const charge = useCallback(
    async (sec: number) => {
      if (chargedRef.current.has(sec)) return true;
      chargedRef.current.add(sec);
      const r = await startReadingSection(token, doc.id, sec);
      gate.apply(r.gate);
      if (!r.allowed) {
        stop();
        return false;
      }
      return true;
    },
    [doc.id, gate, stop, token]
  );

  // ── El bucle ─────────────────────────────────────────────────────────────
  const loopRef = useRef<(now: number) => void>(() => {});

  const loop = useCallback(
    (now: number) => {
      if (!playingRef.current) return;
      const list = chunksRef.current;

      if (now >= nextAtRef.current) {
        const next = idxRef.current + 1;
        if (next >= list.length) {
          idxRef.current = list.length - 1;
          setWord(list[idxRef.current].wordIndex);
          stop();
          flush(true);
          return;
        }
        idxRef.current = next;
        setWord(list[next].wordIndex);
        nextAtRef.current = now + chunkDurationMs(list[next], wpmRef.current);

        const sec = sectionOf(list[next].wordIndex);
        if (!chargedRef.current.has(sec)) void charge(sec);
      }

      // Tiempo leído y descansos: se miden aquí para no montar otro temporizador.
      // Delta real acotado a 1 s: si el navegador estranguló la pestaña, ese
      // hueco no puede contar como tiempo de lectura.
      const dt = Math.min(1, Math.max(0, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      unsavedSecondsRef.current += dt;
      breakSecondsRef.current += dt;
      if (prefs.breakMinutes > 0 && breakSecondsRef.current >= prefs.breakMinutes * 60) {
        breakSecondsRef.current = 0;
        stop();
        setPanel("descanso");
        return;
      }
      if (now - lastSaveRef.current > SAVE_EVERY_MS) flush();

      rafRef.current = requestAnimationFrame(t => loopRef.current(t));
    },
    [charge, flush, prefs.breakMinutes, stop]
  );

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  const play = useCallback(async () => {
    if (needsWarning || playingRef.current || !chunksRef.current.length) return;
    const ok = await charge(sectionOf(chunksRef.current[idxRef.current]?.wordIndex ?? 0));
    if (!ok) return;
    playingRef.current = true;
    setPlaying(true);
    setAutoHidden(false);
    const now = performance.now();
    lastSaveRef.current = now;
    lastFrameRef.current = now;
    nextAtRef.current = now + chunkDurationMs(chunksRef.current[idxRef.current], wpmRef.current);
    rafRef.current = requestAnimationFrame(t => loopRef.current(t));
  }, [charge, needsWarning]);

  const toggle = useCallback(() => {
    if (playingRef.current) {
      stop();
      flush();
    } else {
      void play();
    }
  }, [flush, play, stop]);

  /** Mover el cursor a mano. NO cobra: cobrará al reanudar la reproducción. */
  const seekWord = useCallback((w: number) => {
    const i = chunkIndexForWord(chunksRef.current, w);
    idxRef.current = i;
    setWord(chunksRef.current[i]?.wordIndex ?? 0);
    nextAtRef.current = performance.now() + chunkDurationMs(chunksRef.current[i], wpmRef.current);
  }, []);

  // ── Preferencias (con retardo, para no escribir en cada pulsación) ────────
  const updatePrefs = useCallback(
    (patch: Partial<ReadingPrefs>) => {
      setPrefs(p => ({ ...p, ...patch }));
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => void saveReadingPrefs(token, patch), 600);
    },
    [token]
  );

  // ── Atajos ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekWord(previousSentenceWord(chunksRef.current, idxRef.current));
          break;
        case "ArrowRight":
          e.preventDefault();
          seekWord(nextSentenceWord(chunksRef.current, idxRef.current));
          break;
        case "ArrowUp":
          e.preventDefault();
          updatePrefs({ wpm: Math.min(WPM_MAX, prefs.wpm + WPM_STEP) });
          break;
        case "ArrowDown":
          e.preventDefault();
          updatePrefs({ wpm: Math.max(WPM_MIN, prefs.wpm - WPM_STEP) });
          break;
        case "1":
        case "2":
        case "3":
          updatePrefs({ chunkSize: Number(e.key) });
          break;
        case "Escape":
          if (panel) setPanel(null);
          else {
            stop();
            flush();
            onExit();
          }
          break;
        case "?":
          setPanel(p => (p === "atajos" ? null : "atajos"));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, onExit, panel, prefs.wpm, seekWord, stop, toggle, updatePrefs]);

  // ── Controles que se desvanecen mientras se lee ──────────────────────────
  useEffect(() => {
    if (!playing || panel) return;
    let t = setTimeout(() => setAutoHidden(true), HIDE_CONTROLS_MS);
    const arm = () => {
      setAutoHidden(false);
      clearTimeout(t);
      t = setTimeout(() => setAutoHidden(true), HIDE_CONTROLS_MS);
    };
    window.addEventListener("mousemove", arm);
    window.addEventListener("touchstart", arm);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", arm);
      window.removeEventListener("touchstart", arm);
    };
  }, [playing, panel]);

  // El muro cayó a media lectura.
  if (gate.state?.walled) {
    return <SessionLockScreen gate={gate.state} onElapsed={gate.refresh} />;
  }

  const pct = total > 1 ? (word / (total - 1)) * 100 : 0;
  const fade = showControls ? "opacity-100" : "opacity-0 pointer-events-none";

  return (
    <main className="min-h-[100dvh] bg-[#040a08] text-white flex flex-col">
      {/* Cabecera */}
      <div className={`flex items-center gap-3 px-4 sm:px-6 py-3 transition-opacity duration-200 ${fade}`}>
        <button
          onClick={() => {
            stop();
            flush();
            onExit();
          }}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm font-bold"
        >
          <ArrowLeft className="w-4 h-4" /> Salir
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-bold text-zinc-300">{doc.title}</p>
        </div>
        <SessionMeter gate={gate.state} />
        <button
          onClick={() => setPanel(p => (p === "texto" ? null : "texto"))}
          aria-label="Ver el texto completo"
          title="Ver el texto completo"
          className="text-zinc-400 hover:text-white p-2"
        >
          <Eye className="w-4 h-4" />
        </button>
        <button
          onClick={() => setPanel(p => (p === "ajustes" ? null : "ajustes"))}
          aria-label="Ajustes de lectura"
          className="text-zinc-400 hover:text-white p-2"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Sección actual: ESTA es la región que anuncia el lector de pantalla.
          El chorro de palabras va con aria-hidden (ver OrpWord). */}
      <div role="status" aria-live="polite" className="sr-only">
        {sections > 0 ? `Sección ${section + 1} de ${sections}` : ""}
      </div>

      {/* El chorro */}
      <div className="flex-1 flex items-center justify-center px-4">
        {current ? (
          <OrpWord
            text={current.text}
            orp={current.orp}
            fontSize={prefs.fontSize}
            highlightStyle={prefs.highlightStyle}
          />
        ) : (
          <p className="text-zinc-500">Este documento no tiene texto.</p>
        )}
      </div>

      {/* Controles */}
      <div className={`px-4 sm:px-6 pb-6 transition-opacity duration-200 ${fade}`}>
        <div className="max-w-3xl mx-auto">
          {/* Progreso. Arrastrarlo NO cobra unidades. */}
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={word}
            onChange={e => seekWord(Number(e.target.value))}
            aria-label="Posición en el documento"
            aria-valuetext={`Palabra ${word} de ${total}`}
            className="w-full accent-emerald-400"
          />
          <div className="flex justify-between text-xs text-zinc-500 mb-4">
            <span>{Math.round(pct)}%</span>
            <span>
              Sección {section + 1}/{sections} · quedan{" "}
              {estimateMinutes(total - word, prefs.wpm)} min
            </span>
          </div>

          <div className="flex items-center justify-center gap-3 mb-5">
            <button
              onClick={() => seekWord(previousSentenceWord(chunksRef.current, idxRef.current))}
              aria-label="Frase anterior"
              className="p-3 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-emerald-400/50"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={toggle}
              aria-label={playing ? "Pausar" : "Reproducir"}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 flex items-center justify-center transition-colors"
            >
              {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
            </button>
            <button
              onClick={() => seekWord(nextSentenceWord(chunksRef.current, idxRef.current))}
              aria-label="Frase siguiente"
              className="p-3 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-emerald-400/50"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Ecualizador */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => updatePrefs({ wpm: Math.max(WPM_MIN, prefs.wpm - WPM_STEP) })}
                aria-label="Bajar velocidad"
                className="p-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min={WPM_MIN}
                max={WPM_MAX}
                step={WPM_STEP}
                value={prefs.wpm}
                onChange={e => updatePrefs({ wpm: Number(e.target.value) })}
                aria-label="Velocidad de lectura"
                aria-valuetext={`${prefs.wpm} palabras por minuto`}
                className="w-40 accent-emerald-400"
              />
              <button
                onClick={() => updatePrefs({ wpm: Math.min(WPM_MAX, prefs.wpm + WPM_STEP) })}
                aria-label="Subir velocidad"
                className="p-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="text-sm font-bold text-emerald-300 tabular-nums w-20">
                {prefs.wpm} ppm
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map(n => (
                <button
                  key={n}
                  onClick={() => updatePrefs({ chunkSize: n })}
                  aria-label={`${n} palabra${n > 1 ? "s" : ""} a la vez`}
                  className={`w-9 h-9 rounded-xl text-sm font-bold border transition-colors ${
                    prefs.chunkSize === n
                      ? "bg-emerald-500/15 border-emerald-400/50 text-emerald-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-white"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPanel("atajos")}
              className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300"
            >
              <Keyboard className="w-3.5 h-3.5" /> Atajos
            </button>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {WPM_PRESETS.map(p => (
              <button
                key={p}
                onClick={() => updatePrefs({ wpm: p })}
                className="px-3 py-1 rounded-full text-xs font-bold bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-emerald-300 hover:border-emerald-400/40"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Aviso de fotosensibilidad: una sola vez por cuenta ────────────── */}
      {needsWarning && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6 text-center"
          >
            <h2 className="text-lg font-bold text-white mb-3">Antes de empezar</h2>
            <p className="text-sm text-zinc-400 leading-relaxed mb-5">
              La lectura veloz cambia el texto varias veces por segundo. Si tienes
              epilepsia fotosensible, migraña con aura o te mareas con el movimiento en
              pantalla, no uses este modo: pulsa el ojo de arriba para leer el documento
              como texto normal.
            </p>
            <p className="text-xs text-zinc-600 mb-5">
              Empieza en 300 ppm y sube de 25 en 25. Descansa cada 20 minutos.
            </p>
            <button
              onClick={() => {
                setNeedsWarning(false);
                updatePrefs({ warningAckAt: new Date().toISOString() });
              }}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-2xl py-3 font-bold"
            >
              Entiendo
            </button>
          </motion.div>
        </div>
      )}

      {/* ── Descanso ─────────────────────────────────────────────────────── */}
      {panel === "descanso" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 text-center">
            <Coffee className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-white mb-2">
              Llevas {prefs.breakMinutes} minutos
            </h2>
            <p className="text-sm text-zinc-400 mb-5">
              Descansa la vista: mira algo lejano durante 20 segundos.
            </p>
            <button
              onClick={() => setPanel(null)}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-2xl py-3 font-bold"
            >
              Seguir leyendo
            </button>
          </div>
        </div>
      )}

      {/* ── Ajustes ──────────────────────────────────────────────────────── */}
      {panel === "ajustes" && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">Ajustes de lectura</h2>
              <button onClick={() => setPanel(null)} aria-label="Cerrar" className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="block mb-5">
              <span className="text-sm font-bold text-zinc-300">
                Tamaño de letra: {prefs.fontSize}px
              </span>
              <input
                type="range"
                min={24}
                max={96}
                step={4}
                value={prefs.fontSize}
                onChange={e => updatePrefs({ fontSize: Number(e.target.value) })}
                className="w-full accent-emerald-400 mt-2"
              />
            </label>

            <div className="mb-5">
              <span className="text-sm font-bold text-zinc-300 block mb-2">Resaltado del pivote</span>
              <div className="flex gap-2">
                {(["rojo", "subrayado", "negrita"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => updatePrefs({ highlightStyle: s })}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border capitalize transition-colors ${
                      prefs.highlightStyle === s
                        ? "bg-emerald-500/15 border-emerald-400/50 text-emerald-300"
                        : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-white"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-600 mt-2">
                Si no distingues bien el rojo sobre el verde, usa subrayado.
              </p>
            </div>

            <label className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-300">Pausas en la puntuación</span>
              <input
                type="checkbox"
                checked={prefs.dynamicPauses}
                onChange={e => updatePrefs({ dynamicPauses: e.target.checked })}
                className="w-4 h-4 accent-emerald-400"
              />
            </label>
            <label className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-300">Más tiempo a las palabras largas</span>
              <input
                type="checkbox"
                checked={prefs.longWordBoost}
                onChange={e => updatePrefs({ longWordBoost: e.target.checked })}
                className="w-4 h-4 accent-emerald-400"
              />
            </label>

            <label className="block mt-4">
              <span className="text-sm text-zinc-300">
                Recordarme descansar:{" "}
                {prefs.breakMinutes === 0 ? "nunca" : `cada ${prefs.breakMinutes} min`}
              </span>
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={prefs.breakMinutes}
                onChange={e => updatePrefs({ breakMinutes: Number(e.target.value) })}
                className="w-full accent-emerald-400 mt-2"
              />
            </label>
          </div>
        </div>
      )}

      {/* ── Texto completo: la ruta accesible de verdad ───────────────────── */}
      {panel === "texto" && (
        <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">{doc.title}</h2>
              <button
                onClick={() => setPanel(null)}
                className="flex items-center gap-1.5 text-sm font-bold text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" /> Cerrar
              </button>
            </div>
            <article className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {doc.content}
            </article>
          </div>
        </div>
      )}

      {/* ── Atajos ───────────────────────────────────────────────────────── */}
      {panel === "atajos" && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Atajos</h2>
              <button onClick={() => setPanel(null)} aria-label="Cerrar" className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              {[
                ["Espacio", "Reproducir / pausar"],
                ["← →", "Frase anterior / siguiente"],
                ["↑ ↓", "±25 ppm"],
                ["1 2 3", "Palabras por vez"],
                ["Esc", "Salir (guarda el progreso)"],
                ["?", "Este panel"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="font-mono text-emerald-300">{k}</dt>
                  <dd className="text-zinc-400 text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </main>
  );
}
