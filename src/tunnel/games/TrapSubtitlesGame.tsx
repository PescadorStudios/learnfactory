// ============================================================================
// SUBTÍTULOS TRAMPA — el reto insignia (Capa 3).
// ----------------------------------------------------------------------------
// Los subtítulos pasan solos, cronometrados. Algunos MIENTEN (isTrap). El
// viajero "escanea" (toca el subtítulo o pulsa Espacio) en el momento en que
// detecta la mentira. Cazar una trampa = acierto; tocar un dato verdadero gasta
// un escaneo; dejar pasar una trampa, se escapa. Escaneos limitados (no spamear)
// y un pequeño margen de reacción para la trampa recién salida de pantalla.
//
// Reloj: el mock no trae audioUrl, así que el reto corre sobre un reloj virtual
// (rAF) con los tiempos start/end de cada segmento, y la VOZ real la pone un TTS
// (audio/voice.ts) que lee cada subtítulo al aparecer — silenciable desde el HUD
// y con degradación elegante si el navegador no soporta TTS. Si llegara un
// `audioUrl` real, audio/voice.ts es el punto para reproducirlo con Howler y
// anclar el reloj a su currentTime, sin tocar nada más del motor.
// Agnóstico: solo lee `TrapSubtitlesChallenge`; nada temático aquí.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type { TrapSubtitlesChallenge } from "../types/contract";
import { useJourney } from "../state/journeyStore";
import type { ChallengeResult } from "../state/journeyStore";
import { speak, stopVoice, primeVoice } from "../audio/voice";

const GRACE = 1.4; // s para cazar una trampa recién salida de pantalla
const END_PAD = 1.2; // s de cola tras el último subtítulo

type Flash = "hit" | "miss" | null;

export function TrapSubtitlesGame({
  challenge,
  color,
  onResult,
}: {
  challenge: TrapSubtitlesChallenge;
  color: string;
  onResult: (r: ChallengeResult) => void;
}) {
  const segs = challenge.segments;
  const traps = useMemo(() => segs.filter((s) => s.isTrap).length, [segs]);
  const duration = useMemo(
    () => segs.reduce((m, s) => Math.max(m, s.end), 0) + END_PAD,
    [segs]
  );
  const passCount = Math.max(1, Math.ceil(traps * 0.6));
  const maxScans = traps + 4;

  const [t, setT] = useState(0);
  const [caughtN, setCaughtN] = useState(0);
  const [falseTaps, setFalseTaps] = useState(0);
  const [flash, setFlash] = useState<Flash>(null);

  const caughtRef = useRef<Set<number>>(new Set());
  const falseRef = useRef(0);
  const doneRef = useRef(false);
  const flashTimer = useRef(0);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  const muted = useJourney((s) => s.muted);
  const spokenIdxRef = useRef(-1); // último índice ya leído por la voz

  // Reloj virtual. (Si llegara audioUrl real, anclar aquí a currentTime.)
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      if (doneRef.current) return;
      const elapsed = (performance.now() - start) / 1000;
      setT(elapsed);
      if (elapsed >= duration) {
        doneRef.current = true;
        const c = caughtRef.current.size;
        const success = traps === 0 ? true : c >= passCount && falseRef.current <= 2;
        window.setTimeout(
          () => cbRef.current({ success, score: c, total: traps }),
          900
        );
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(flashTimer.current);
    };
  }, [duration, traps, passCount]);

  // Subtítulo visible = el último cuyo inicio ya pasó (segmentos contiguos).
  const currentIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].start <= t) idx = i;
      else break;
    }
    return idx;
  }, [segs, t]);

  const scansUsed = caughtN + falseTaps;
  const scansLeft = Math.max(0, maxScans - scansUsed);

  function showFlash(kind: Exclude<Flash, null>) {
    setFlash(kind);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 650);
  }

  function scan() {
    if (doneRef.current || scansLeft <= 0) return;
    const tryCatch = (i: number): boolean => {
      if (i < 0 || i >= segs.length) return false;
      if (segs[i].isTrap && !caughtRef.current.has(i)) {
        caughtRef.current.add(i);
        setCaughtN(caughtRef.current.size);
        return true;
      }
      return false;
    };
    let hit = tryCatch(currentIdx);
    // Margen de reacción: la trampa anterior salió de pantalla hace poco.
    if (!hit && currentIdx > 0 && t - segs[currentIdx].start < GRACE) {
      hit = tryCatch(currentIdx - 1);
    }
    if (!hit) {
      falseRef.current += 1;
      setFalseTaps(falseRef.current);
    }
    showFlash(hit ? "hit" : "miss");
  }
  const scanRef = useRef(scan);
  scanRef.current = scan;

  // Tecla Espacio = escanear (atajo de escritorio).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        scanRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Precalienta la voz de Learn Factory (Charon) al montar: sintetiza/cachea en
  // segundo plano cada línea (su versión `spoken`, apta para TTS) para que el
  // primer subtítulo ya suene en Charon. Lo que no llegue a tiempo cae a Web
  // Speech sin cortar el reto.
  useEffect(() => {
    primeVoice(segs.map((s) => s.spoken ?? s.text));
  }, [segs]);

  // Voz: narra cada subtítulo al aparecer con la voz Charon (Web Speech si
  // falla; silencio si no hay ninguna). Silenciable desde el HUD. Narra la
  // versión `spoken` (apta para TTS) si existe; si no, el propio `text`.
  useEffect(() => {
    if (muted || doneRef.current) return;
    if (currentIdx < 0 || currentIdx >= segs.length) return;
    if (spokenIdxRef.current === currentIdx) return;
    spokenIdxRef.current = currentIdx;
    const cur = segs[currentIdx];
    speak(cur.spoken ?? cur.text, { lang: "es-ES", rate: 1.05 });
  }, [currentIdx, muted, segs]);

  // Corta la voz al silenciar y al desmontar (fin del reto / salida del túnel).
  useEffect(() => {
    if (muted) stopVoice();
  }, [muted]);
  useEffect(() => () => stopVoice(), []);

  const seg = currentIdx >= 0 ? segs[currentIdx] : null;
  const caughtNow = currentIdx >= 0 && caughtRef.current.has(currentIdx);
  const pct = Math.min(1, t / duration);
  const noScans = scansLeft <= 0 && !doneRef.current;

  return (
    <div className="game game--trap">
      <p className="game__prompt">Caza las mentiras</p>
      <p className="game__hint muted small">
        Los subtítulos pasan solos. Toca (o pulsa Espacio) cuando uno MIENTA.
      </p>

      <div className="trap__hud">
        <span className="trap__chip" style={{ color }}>
          ⚠ Trampas {caughtN}/{traps}
        </span>
        <span className={`trap__chip ${scansLeft <= 2 ? "is-low" : ""}`}>
          ◎ Escaneos {scansLeft}
        </span>
      </div>

      <div className="timer" aria-hidden>
        <span
          className="timer__bar"
          style={{ width: `${pct * 100}%`, background: color }}
        />
      </div>

      <button
        type="button"
        className={`subtitle ${
          flash ? `subtitle--${flash}` : caughtNow ? "subtitle--caught" : ""
        }`}
        onClick={() => scanRef.current()}
        disabled={noScans}
      >
        <span className="subtitle__text">{seg ? seg.text : "…"}</span>
        {flash === "hit" && (
          <span className="subtitle__fb subtitle__fb--hit">¡Trampa cazada!</span>
        )}
        {flash === "miss" && (
          <span className="subtitle__fb subtitle__fb--miss">Eso era verdad…</span>
        )}
        {caughtNow && !flash && <span className="subtitle__badge">✓ cazada</span>}
      </button>

      <p className="muted small trap__foot">
        {noScans
          ? "Te quedaste sin escaneos: deja correr el resto."
          : `Caza ${passCount} de ${traps} para sentir el clic.`}
      </p>
    </div>
  );
}
