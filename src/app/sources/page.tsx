"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { FileUp, Link as LinkIcon, Bot, ArrowRight, X, Loader2 } from "lucide-react";

function Sources() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic") || "";
  
  const [sources, setSources] = useState<{ id: string; type: string; name: string; content?: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // States for inputs
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!topic) router.push("/");
  }, [topic, router]);

  const addSource = (type: string, name: string, content?: string) => {
    setSources([...sources, { id: Math.random().toString(), type, name, content }]);
  };

  const handleRemove = (id: string) => {
    setSources(sources.filter((s) => s.id !== id));
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlValue.trim()) {
      addSource("url", urlValue.trim());
      setUrlValue("");
      setShowUrlInput(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      addSource("file", file.name);
      // We would normally read the file or upload it here
    }
  };

  const handleGenerateKnowledge = () => {
    setIsGenerating(true);
    // Convert sources to a query param or pass via localStorage/state
    const sourcesStr = sources.map(s => s.name).join(",");
    setTimeout(() => {
      setIsGenerating(false);
      router.push(`/tree?topic=${encodeURIComponent(topic)}&sources=${encodeURIComponent(sourcesStr)}`);
    }, 500);
  };

  return (
    <main className="min-h-screen flex flex-col p-6 md:p-12 relative overflow-hidden bg-zinc-950">
      <div className="max-w-4xl w-full mx-auto z-10">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="text-zinc-500 mb-2 font-medium">Fase 2: Recolección de Fuentes</h2>
          <h1 className="text-3xl md:text-5xl font-bold mb-8">
            ¿De dónde quieres aprender sobre <span className="text-primary">{topic}</span>?
          </h1>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* FILE UPLOAD BUTTON */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
            accept=".pdf,.txt,.docx,.epub"
          />
          <motion.button
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center p-8 bg-zinc-900 border border-zinc-800 border-dashed rounded-3xl hover:bg-zinc-800/50 hover:border-primary/50 transition-all group relative overflow-hidden"
          >
            <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <FileUp className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Subir Documentos</h3>
            <p className="text-zinc-500 text-sm text-center">PDF, DOCX, EPUB, TXT</p>
          </motion.button>

          {/* URL UPLOAD BUTTON */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center justify-center p-8 bg-zinc-900 border border-zinc-800 border-dashed rounded-3xl hover:border-secondary/50 transition-all relative overflow-hidden"
          >
            <AnimatePresence mode="wait">
              {!showUrlInput ? (
                <motion.button
                  key="btn"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowUrlInput(true)}
                  className="w-full h-full flex flex-col items-center justify-center group"
                >
                  <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <LinkIcon className="w-8 h-8 text-secondary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Añadir Enlaces</h3>
                  <p className="text-zinc-500 text-sm text-center">URLs, Videos de YouTube</p>
                </motion.button>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onSubmit={handleUrlSubmit}
                  className="w-full flex flex-col items-center"
                >
                  <LinkIcon className="w-8 h-8 text-secondary mb-4" />
                  <input
                    type="url"
                    autoFocus
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 mb-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-secondary"
                  />
                  <div className="flex gap-2 w-full">
                    <button type="button" onClick={() => setShowUrlInput(false)} className="flex-1 py-2 text-zinc-500 hover:text-white transition-colors">Cancelar</button>
                    <button type="submit" disabled={!urlValue} className="flex-1 py-2 bg-secondary text-white font-bold rounded-xl disabled:opacity-50 hover:bg-secondary/80 transition-colors">Añadir</button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="md:col-span-2 relative overflow-hidden p-1 rounded-3xl bg-gradient-to-r from-primary/20 via-secondary/20 to-accent/20"
          >
            <button
              onClick={() => addSource("ai", "Búsqueda Autónoma de IA")}
              className="w-full flex flex-col items-center justify-center p-8 bg-zinc-900/90 backdrop-blur-sm rounded-[22px] hover:bg-zinc-900/70 transition-all group"
            >
              <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-4 group-hover:rotate-12 transition-transform">
                <Bot className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-xl font-semibold mb-2">IA busca las mejores fuentes</h3>
              <p className="text-zinc-400 text-sm text-center max-w-md">
                Encuentra automáticamente libros, conferencias y artículos evaluando autoridad, calidad y sesgos.
              </p>
            </button>
          </motion.div>
        </div>

        {sources.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 mb-8"
          >
            <h3 className="text-lg font-medium mb-4 flex items-center justify-between">
              Fuentes Seleccionadas ({sources.length})
              <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full">Listo para procesar</span>
            </h3>
            <ul className="space-y-3 mb-6">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center justify-between bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                  <div className="flex items-center gap-3">
                    {s.type === "file" && <FileUp className="w-4 h-4 text-primary" />}
                    {s.type === "url" && <LinkIcon className="w-4 h-4 text-secondary" />}
                    {s.type === "ai" && <Bot className="w-4 h-4 text-accent" />}
                    <span className="text-sm font-medium">{s.name}</span>
                  </div>
                  <button onClick={() => handleRemove(s.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>

            <button
              onClick={handleGenerateKnowledge}
              disabled={isGenerating}
              className="w-full py-4 bg-white text-zinc-950 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all disabled:opacity-70"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Extrayendo Knowledge DNA...
                </>
              ) : (
                <>
                  Generar Árbol de Conocimiento
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </motion.div>
        )}
      </div>
    </main>
  );
}

export default function SourcesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
        </div>
      }
    >
      <Sources />
    </Suspense>
  );
}
