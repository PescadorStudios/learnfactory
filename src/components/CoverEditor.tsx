"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Sparkles, Upload, X } from "lucide-react";
import { generateRouteCover, uploadRouteCover } from "@/app/socialActions";

export default function CoverEditor({
  token,
  routeId,
  topic,
  currentCoverUrl,
  currentPrompt,
  onUpdated,
  onClose,
}: {
  token: string;
  routeId: string;
  topic: string;
  currentCoverUrl: string | null;
  currentPrompt: string | null;
  onUpdated: (url: string) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(currentPrompt || `Portada elegante para un curso sobre ${topic}`);
  const [preview, setPreview] = useState<string | null>(currentCoverUrl);
  const [busy, setBusy] = useState<"ai" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAi = async () => {
    setBusy("ai");
    setError(null);
    const res = await generateRouteCover(token, routeId, prompt);
    setBusy(null);
    if (res.ok && res.coverUrl) {
      setPreview(res.coverUrl);
      onUpdated(res.coverUrl);
    } else {
      setError(res.error || "No se pudo generar la portada.");
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("upload");
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result);
      const res = await uploadRouteCover(token, routeId, base64);
      setBusy(null);
      if (res.ok && res.coverUrl) {
        setPreview(res.coverUrl);
        onUpdated(res.coverUrl);
      } else {
        setError(res.error || "No se pudo subir la imagen.");
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-lg"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Editar portada</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 mb-4">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="portada" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">Sin portada</div>
          )}
        </div>

        <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold">Prompt de IA</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          className="w-full mt-1 mb-3 bg-zinc-950 border border-zinc-800 rounded-2xl p-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
          placeholder="Describe la portada que quieres..."
        />

        {error && <p className="text-rose-400 text-sm mb-3">{error}</p>}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleAi}
            disabled={busy !== null}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-2xl py-3 font-bold transition-all disabled:opacity-60"
          >
            {busy === "ai" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generar con IA
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl py-3 font-bold transition-all disabled:opacity-60"
          >
            {busy === "upload" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Subir imagen
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
        </div>
      </motion.div>
    </div>
  );
}
