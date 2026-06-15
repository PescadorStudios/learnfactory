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
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const chunk = transcript.trim();
          if (chunk) onResultRef.current(chunk);
        } else {
          interim += transcript;
        }
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      setError(errorMessage(event.error));
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;

    return () => {
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
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if called while already started; ignore.
    }
  }, [listening, stop]);

  return { supported, listening, interimTranscript, error, toggle, stop };
}
