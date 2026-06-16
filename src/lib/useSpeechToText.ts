"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API types are not part of the standard lib.dom typings, so we
// declare the minimal surface we use here.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function errorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permiso de micrófono denegado.";
    case "no-speech":
      return "No se detectó voz. Inténtalo de nuevo.";
    case "audio-capture":
      return "No se encontró un micrófono.";
    default:
      return "No se pudo usar el dictado por voz.";
  }
}

interface UseSpeechToTextOptions {
  lang?: string;
  onResult: (finalChunk: string) => void;
}

interface UseSpeechToTextResult {
  supported: boolean;
  listening: boolean;
  interimTranscript: string;
  error: string | null;
  toggle: () => void;
  stop: () => void;
}

export function useSpeechToText({
  lang = "es-ES",
  onResult,
}: UseSpeechToTextOptions): UseSpeechToTextResult {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest onResult without re-creating the recognition instance.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  // Intención del usuario de seguir dictando (para auto-reiniciar en Android,
  // que ignora `continuous` y corta tras cada pausa).
  const shouldListenRef = useRef(false);
  // Error fatal (sin permiso/mic): no reiniciar para evitar bucles.
  const fatalErrorRef = useRef(false);
  // Nº de resultados FINALES ya emitidos en la sesión actual. Android reentrega
  // los finales ya entregados en cada `onresult`; emitimos solo los nuevos para
  // no duplicar palabras.
  const emittedFinalsRef = useRef(0);

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    // Detect capability after mount so the initial client render matches the
    // server (avoids a hydration mismatch when the button is hidden).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(Ctor !== null);
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = "";
      let finalCount = 0;
      // Recorremos TODO el array (es acumulativo dentro de una sesión) en vez de
      // confiar en `event.resultIndex`, que Android no avanza de forma fiable.
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          // Emitir solo los finales que aún no habíamos entregado.
          if (finalCount >= emittedFinalsRef.current) {
            const chunk = transcript.trim();
            if (chunk) onResultRef.current(chunk);
          }
          finalCount++;
        } else {
          interim += transcript;
        }
      }
      emittedFinalsRef.current = finalCount;
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      const code = event.error;
      // not-allowed/audio-capture son fatales: no reiniciar. no-speech/aborted
      // son transitorios en Android; dejamos que onend reinicie la escucha.
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
        fatalErrorRef.current = true;
        shouldListenRef.current = false;
        setError(errorMessage(code));
        setListening(false);
      }
    };

    recognition.onend = () => {
      if (shouldListenRef.current && !fatalErrorRef.current) {
        // Android corta tras cada pausa: reiniciamos la misma sesión lógica.
        emittedFinalsRef.current = 0;
        setInterimTranscript("");
        try {
          recognition.start();
        } catch {
          // start() puede tirar si se llama demasiado pronto; la próxima
          // interacción del usuario lo recupera.
        }
        return;
      }
      setListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;

    return () => {
      // Evitar que el onend disparado por abort() reinicie tras desmontar.
      shouldListenRef.current = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, [lang]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    shouldListenRef.current = false;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      stop();
      return;
    }
    setError(null);
    setInterimTranscript("");
    shouldListenRef.current = true;
    fatalErrorRef.current = false;
    emittedFinalsRef.current = 0;
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if called while already started; ignore.
    }
  }, [listening, stop]);

  return { supported, listening, interimTranscript, error, toggle, stop };
}
