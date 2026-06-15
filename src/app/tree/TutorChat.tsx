"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, X, Loader2 } from "lucide-react";
import { getTutorHistory, tutorTurn } from "@/app/tutorActions";
import MicButton from "@/app/lesson/MicButton";
import type { TutorMessage } from "@/lib/types";

/**
 * Tutor/Agente estratégico POR RUTA. Vive en la página del árbol (no dentro de
 * las lecciones): responde dudas globales de toda la ruta y recuerda la
 * conversación (memoria por usuario + ruta).
 */
export default function TutorChat({
  routeId,
  token,
  topic,
}: {
  routeId: string;
  token: string;
  topic: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Carga perezosa del historial la primera vez que se abre.
  useEffect(() => {
    if (!open || loadedRef.current || !token) return;
    loadedRef.current = true;
    setLoading(true);
    getTutorHistory(token, routeId)
      .then(setMessages)
      .finally(() => setLoading(false));
  }, [open, token, routeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const handleSend = async () => {
    const text = input.trim();
    if (text.length < 2 || thinking) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setThinking(true);
    const { reply, error } = await tutorTurn(token, routeId, text);
    setMessages((prev) => [...prev, { role: "tutor", content: error || reply }]);
    setThinking(false);
  };

  return (
    <>
      {/* Botón flotante para abrir el tutor */}
      <button
        onClick={() => setOpen(true)}
        title="Tutor de la ruta"
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-primary text-white pl-4 pr-5 py-3.5 font-bold shadow-xl shadow-primary/30 hover:bg-primary-hover transition-all"
      >
        <Sparkles className="w-5 h-5" />
        <span className="hidden sm:inline">Tutor</span>
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="relative w-full sm:max-w-md bg-zinc-950 border-l border-zinc-800 flex flex-col h-[100dvh]"
            >
              {/* Cabecera */}
              <header className="flex items-center justify-between p-4 border-b border-zinc-800">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-bold text-primary">
                    <Sparkles className="w-3.5 h-3.5" /> Tutor de la ruta
                  </p>
                  <p className="text-sm text-zinc-300 truncate">{topic}</p>
                </div>
                <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </header>

              {/* Conversación */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 text-zinc-500 py-10">
                    <Loader2 className="w-5 h-5 animate-spin" /> Cargando conversación...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-zinc-500 text-sm py-10 px-4">
                    <Sparkles className="w-8 h-8 text-primary/60 mx-auto mb-3" />
                    Pregúntame lo que quieras sobre <span className="text-zinc-300 font-semibold">{topic}</span>:
                    cómo se conectan los conceptos, por dónde seguir o qué repasar. Recuerdo nuestra conversación
                    en esta ruta.
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`relative max-w-[88%] p-3.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-primary/20 border border-primary/40 text-zinc-100 rounded-br-sm"
                            : "bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-bl-sm"
                        }`}
                      >
                        {m.content}
                      </div>
                    </motion.div>
                  ))
                )}

                {thinking && (
                  <div className="flex items-center gap-2 text-zinc-500 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> El tutor está pensando...
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Entrada */}
              <div className="border-t border-zinc-800 p-4">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    rows={2}
                    placeholder="Escribe o dicta tu pregunta..."
                    disabled={thinking}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
                  />
                  <MicButton
                    disabled={thinking}
                    onTranscript={(chunk) => setInput((prev) => (prev ? prev.trimEnd() + " " : "") + chunk)}
                  />
                  <button
                    onClick={handleSend}
                    disabled={input.trim().length < 2 || thinking}
                    className="shrink-0 w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center hover:bg-primary-hover transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
