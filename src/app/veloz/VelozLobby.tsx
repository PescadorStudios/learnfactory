"use client";

// Biblioteca privada del modo. Cada tarjeta es un documento del usuario y de
// nadie más: no hay botón de compartir ni de publicar, y no lo va a haber.

import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Lock, Pencil, Plus, Trash2, Zap } from "lucide-react";
import type { ReadingDocSummary } from "@/lib/types";
import { estimateMinutes } from "@/lib/rsvp";

function pct(d: ReadingDocSummary): number {
  if (d.wordCount < 2) return 0;
  return Math.min(100, Math.round((d.cursorWord / (d.wordCount - 1)) * 100));
}

export default function VelozLobby({
  docs,
  wpm,
  onOpen,
  onImport,
  onRename,
  onDelete,
}: {
  docs: ReadingDocSummary[];
  wpm: number;
  onOpen: (docId: string) => void;
  onImport: () => void;
  onRename: (docId: string, title: string) => void;
  onDelete: (docId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300/90 mb-3">
          <Zap className="w-3.5 h-3.5" /> Lectura Veloz
        </span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-emerald-200 to-lime-200">
            Tu biblioteca privada
          </span>
        </h1>
        <p className="text-zinc-400 max-w-xl">
          Pega el texto de un libro o suelta un PDF y léelo palabra a palabra, sin mover
          los ojos. Empieza en 300 ppm y sube de 25 en 25.
        </p>
        <p className="inline-flex items-center gap-1.5 text-xs text-zinc-600 mt-3">
          <Lock className="w-3.5 h-3.5" /> Solo tú ves estos documentos. No se comparten,
          no aparecen en la biblioteca pública y no pasan por ninguna IA.
        </p>
      </div>

      <button
        onClick={onImport}
        className="w-full mb-6 border border-dashed border-emerald-500/30 hover:border-emerald-400/60 rounded-2xl py-6 flex items-center justify-center gap-2 text-emerald-300/80 hover:text-emerald-300 font-bold transition-colors"
      >
        <Plus className="w-5 h-5" /> Añadir documento
      </button>

      {docs.length === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Todavía no has añadido nada.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {docs.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3) }}
              className="group relative rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 hover:border-emerald-400/40 transition-colors"
            >
              <button onClick={() => onOpen(d.id)} className="w-full text-left">
                <h2 className="font-bold text-white truncate pr-16">{d.title}</h2>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">
                  {d.author ? `${d.author} · ` : ""}
                  {d.wordCount.toLocaleString("es")} palabras ·{" "}
                  {estimateMinutes(Math.max(0, d.wordCount - d.cursorWord), wpm)} min restantes
                </p>

                <div className="mt-4 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-lime-300"
                    style={{ width: `${pct(d)}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-600 mt-2">
                  {d.completedAt ? "Terminado" : d.cursorWord > 0 ? `${pct(d)}% leído` : "Sin empezar"}
                </p>
              </button>

              <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    const t = window.prompt("Nuevo título", d.title);
                    if (t && t.trim()) onRename(d.id, t.trim());
                  }}
                  aria-label={`Renombrar ${d.title}`}
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setConfirming(d.id)}
                  aria-label={`Eliminar ${d.title}`}
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {confirming === d.id && (
                <div className="absolute inset-0 rounded-2xl bg-zinc-950/95 flex flex-col items-center justify-center gap-3 p-4 text-center">
                  <p className="text-sm text-zinc-300">
                    ¿Eliminar <strong>{d.title}</strong>? Se borra el texto completo.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirming(null)}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        setConfirming(null);
                        onDelete(d.id);
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-500/15 border border-rose-500/40 text-rose-300"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
