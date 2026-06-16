"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, X, Loader2, Plus, MessagesSquare, Trash2 } from "lucide-react";
import {
  getTutorHistory,
  tutorTurn,
  listTutorThreads,
  createTutorThread,
  deleteTutorThread,
} from "@/app/tutorActions";
import MicButton from "@/app/lesson/MicButton";
import type { TutorMessage, TutorThread } from "@/lib/types";

/**
 * Tutor/Agente estratégico POR RUTA. Vive en la página del árbol (no dentro de
 * las lecciones): responde dudas globales de toda la ruta. Soporta MÚLTIPLES
 * conversaciones (threads), cada una con su propio contexto/memoria, para
 * manejar varios temas en paralelo.
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
  const [view, setView] = useState<"chat" | "list">("chat");

  const [threads, setThreads] = useState<TutorThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId) || null;

  const loadHistory = async (threadId: string) => {
    setLoading(true);
    try {
      const hist = await getTutorHistory(token, routeId, threadId);
      setMessages(hist);
    } finally {
      setLoading(false);
    }
  };

  // Carga perezosa de las conversaciones la primera vez que se abre.
  useEffect(() => {
    if (!open || loadedRef.current || !token) return;
    loadedRef.current = true;
    setLoading(true);
    listTutorThreads(token, routeId)
      .then((ts) => {
        setThreads(ts);
        if (ts.length > 0) {
          setActiveThreadId(ts[0].id);
          return getTutorHistory(token, routeId, ts[0].id).then(setMessages);
        }
        setMessages([]);
      })
      .finally(() => setLoading(false));
  }, [open, token, routeId]);

  useEffect(() => {
    if (view === "chat") bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, view]);

  const handleSelectThread = (id: string) => {
    if (id === activeThreadId) {
      setView("chat");
      return;
    }
    setActiveThreadId(id);
    setView("chat");
    setMessages([]);
    loadHistory(id);
  };

  const handleNewThread = async () => {
    const t = await createTutorThread(token, routeId);
    if (!t) return;
    setThreads((prev) => [t, ...prev]);
    setActiveThreadId(t.id);
    setMessages([]);
    setInput("");
    setView("chat");
  };

  const handleDeleteThread = async (id: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    await deleteTutorThread(token, routeId, id);
    if (id === activeThreadId) {
      const remaining = threads.filter((t) => t.id !== id);
      if (remaining.length > 0) {
        setActiveThreadId(remaining[0].id);
        loadHistory(remaining[0].id);
      } else {
        setActiveThreadId(null);
        setMessages([]);
      }
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (text.length < 2 || thinking) return;

    // Crear la conversación si aún no hay ninguna activa (primer mensaje).
    let threadId = activeThreadId;
    const isFirstMessage = messages.length === 0;
    if (!threadId) {
      const t = await createTutorThread(token, routeId);
      if (!t) {
        setMessages((prev) => [...prev, { role: "tutor", content: "No se pudo iniciar la conversación." }]);
        return;
      }
      threadId = t.id;
      setThreads((prev) => [t, ...prev]);
      setActiveThreadId(t.id);
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setThinking(true);
    const { reply, error } = await tutorTurn(token, routeId, threadId, text);
    setMessages((prev) => [...prev, { role: "tutor", content: error || reply }]);
    setThinking(false);

    // Reflejar título (en el primer mensaje el server lo nombra) y orden.
    setThreads((prev) => {
      const id = threadId as string;
      const found = prev.find((t) => t.id === id);
      if (!found) return prev;
      const updated: TutorThread = {
        ...found,
        title: isFirstMessage ? deriveTitle(text) : found.title,
        updatedAt: new Date().toISOString(),
      };
      return [updated, ...prev.filter((t) => t.id !== id)];
    });
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
              <header className="flex items-center gap-2 p-4 border-b border-zinc-800">
                <button
                  onClick={() => setView((v) => (v === "list" ? "chat" : "list"))}
                  title="Conversaciones"
                  className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    view === "list" ? "bg-primary/20 text-primary" : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                  }`}
                >
                  <MessagesSquare className="w-5 h-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-bold text-primary">
                    <Sparkles className="w-3.5 h-3.5" /> Tutor de la ruta
                  </p>
                  <p className="text-sm text-zinc-300 truncate">
                    {view === "list" ? topic : activeThread?.title || "Nueva conversación"}
                  </p>
                </div>
                <button
                  onClick={handleNewThread}
                  title="Nueva conversación"
                  className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button onClick={() => setOpen(false)} className="shrink-0 text-zinc-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </header>

              {view === "list" ? (
                /* Lista de conversaciones */
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  <button
                    onClick={handleNewThread}
                    className="w-full flex items-center gap-2 p-3 rounded-xl border border-dashed border-zinc-700 text-zinc-300 hover:border-primary hover:text-white transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" /> Nueva conversación
                  </button>
                  {threads.length === 0 ? (
                    <p className="text-center text-zinc-600 text-xs py-8">Aún no tienes conversaciones.</p>
                  ) : (
                    threads.map((t) => (
                      <div
                        key={t.id}
                        className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors ${
                          t.id === activeThreadId ? "bg-primary/15 border border-primary/40" : "hover:bg-zinc-900 border border-transparent"
                        }`}
                      >
                        <button onClick={() => handleSelectThread(t.id)} className="flex-1 min-w-0 text-left">
                          <p className="text-sm text-zinc-200 truncate">{t.title}</p>
                        </button>
                        <button
                          onClick={() => handleDeleteThread(t.id)}
                          title="Eliminar conversación"
                          className="shrink-0 text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <>
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
                        cómo se conectan los conceptos, por dónde seguir o qué repasar. Puedes abrir varias
                        conversaciones para distintos temas.
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
                </>
              )}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Título local a partir del primer mensaje (el server hace lo mismo). */
function deriveTitle(message: string): string {
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length > 48 ? clean.slice(0, 48).trimEnd() + "…" : clean || "Conversación";
}
