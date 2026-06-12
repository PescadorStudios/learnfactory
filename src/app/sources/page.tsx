"use client";

import { Suspense, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { FileUp, Link as LinkIcon, ArrowRight, X, Loader2, Globe, Lock, Crown, Check, Tag, ImagePlus, Wand2, UserRound } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { createRoute, suggestCoverPrompt } from "../routeActions";
import { fileToResizedDataUrl } from "@/lib/imageUtils";
import { extractUrls } from "@/lib/urlUtils";
import { ROUTE_CATEGORIES } from "@/lib/types";
import PremiumCheckout from "@/components/PremiumCheckout";
import { LogoMark } from "@/components/Logo";

function Sources() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic") || "";
  const { token, email } = useRequireAuth();

  const [sources, setSources] = useState<{ id: string; type: string; name: string; content?: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [category, setCategory] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);
  const [topicInput, setTopicInput] = useState("");

  // States for inputs
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Portada: idea breve → el agente redacta el prompt (editable) + referencia
  const [coverIdea, setCoverIdea] = useState("");
  const [coverPrompt, setCoverPrompt] = useState("");
  const [coverReference, setCoverReference] = useState<string | null>(null);
  const [craftingPrompt, setCraftingPrompt] = useState(false);
  const coverRefInputRef = useRef<HTMLInputElement>(null);

  const handleCraftPrompt = async () => {
    if (!token || craftingPrompt) return;
    setCraftingPrompt(true);
    const res = await suggestCoverPrompt(token, topic, coverIdea, Boolean(coverReference));
    setCraftingPrompt(false);
    if (res.ok && res.prompt) setCoverPrompt(res.prompt);
  };

  const handleCoverReference = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setCoverReference(await fileToResizedDataUrl(file, 1024, 1024));
    } catch {
      setGenError("No se pudo leer la imagen de referencia.");
    }
  };

  const handleTopicSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = topicInput.trim();
    if (t) router.push(`/sources?topic=${encodeURIComponent(t)}`);
  };

  const addSource = (type: string, name: string, content?: string) => {
    setSources(prev => [...prev, { id: Math.random().toString(), type, name, content }]);
  };

  /** Añade varias URLs de golpe (pegadas juntas), sin duplicar las existentes. */
  const addUrls = (urls: string[]) => {
    if (urls.length === 0) return;
    setSources(prev => {
      const existing = new Set(prev.map(s => s.name));
      const nuevos = urls
        .filter(u => !existing.has(u))
        .map(u => ({ id: Math.random().toString(), type: "url", name: u }));
      return [...prev, ...nuevos];
    });
  };

  const handleRemove = (id: string) => {
    setSources(sources.filter((s) => s.id !== id));
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = urlValue.trim();
    if (!v) return;
    // Si el campo trae varias URLs (pegadas juntas), se agregan todas
    const urls = extractUrls(v);
    if (urls.length > 0) addUrls(urls);
    else addSource("url", v);
    setUrlValue("");
    setShowUrlInput(false);
  };

  /** Pegar varias URLs a la vez: se agregan todas, listas para generar. */
  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const urls = extractUrls(e.clipboardData.getData("text"));
    if (urls.length >= 2) {
      e.preventDefault();
      addUrls(urls);
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

  const handleGenerateKnowledge = async () => {
    if (!token || !category) return;
    setIsGenerating(true);
    setGenError("");
    const sourcesStr = sources.map(s => s.name).join(",");
    try {
      // Crea la ruta (síntesis + árbol) y arranca la pregeneración en background
      const result = await createRoute(token, topic, sourcesStr, visibility, category, {
        prompt: coverPrompt.trim() || undefined,
        reference: coverReference ?? undefined,
      });
      if (result.routeId) {
        router.push(`/tree?route=${result.routeId}`);
      } else if (result.quotaReached) {
        setShowPaywall(true);
        setIsGenerating(false);
      } else {
        setGenError(result.error || "No se pudo crear la ruta.");
        setIsGenerating(false);
      }
    } catch {
      setGenError("Error de conexión al crear la ruta.");
      setIsGenerating(false);
    }
  };

  // Sin tema todavía: pedirlo aquí mismo (el botón "Crear ruta nueva" entra sin ?topic=)
  if (!topic) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-zinc-950">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-xl text-center"
        >
          <div className="inline-flex items-center gap-2 mb-5 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-full text-zinc-300 text-xs">
            <LogoMark className="w-3.5 h-3.5" /> Fase 1: Tu tema
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mb-3">¿Qué quieres aprender?</h1>
          <p className="text-zinc-400 mb-8">Escribe un tema y la IA construirá tu ruta: podcast, lecciones, debates y examen.</p>
          <form onSubmit={handleTopicSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              autoFocus
              value={topicInput}
              onChange={e => setTopicInput(e.target.value)}
              placeholder="Ej: La Revolución Francesa, Cálculo diferencial, Bitcoin..."
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-5 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary transition-all"
            />
            <button
              type="submit"
              disabled={!topicInput.trim()}
              className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white font-bold rounded-2xl px-6 py-4 transition-all disabled:opacity-50"
            >
              Continuar <ArrowRight className="w-5 h-5" />
            </button>
          </form>
          <button onClick={() => router.push("/")} className="mt-6 text-sm text-zinc-500 hover:text-white transition-colors">
            Volver al inicio
          </button>
        </motion.div>
      </main>
    );
  }

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
                    type="text"
                    inputMode="url"
                    autoFocus
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    onPaste={handleUrlPaste}
                    placeholder="https://... (puedes pegar varias a la vez)"
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
                <LogoMark className="w-9 h-9" />
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
                    {s.type === "ai" && <LogoMark className="w-4 h-4" />}
                    <span className="text-sm font-medium">{s.name}</span>
                  </div>
                  <button onClick={() => handleRemove(s.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>

            {/* Categoría (obligatoria) */}
            <div className="mb-4">
              <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold flex items-center gap-1.5 mb-2">
                <Tag className="w-3.5 h-3.5" /> Categoría de la ruta
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className={`w-full bg-zinc-950 border rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-primary ${
                  category ? "border-zinc-800 text-white" : "border-amber-500/40 text-zinc-500"
                }`}
              >
                <option value="">Elige la categoría...</option>
                {ROUTE_CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Visibilidad: pública por defecto para crecer la biblioteca */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                type="button"
                onClick={() => setVisibility("public")}
                className={`p-4 rounded-xl border text-left transition-all ${
                  visibility === "public" ? "bg-primary/10 border-primary" : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Globe className="w-4 h-4 text-primary" />
                  <span className="font-bold text-sm text-white">Pública</span>
                  {visibility === "public" && <Check className="w-4 h-4 text-primary ml-auto" />}
                </div>
                <p className="text-xs text-zinc-500">Aparece en la biblioteca. Otros pueden estudiarla y sumas estudiantes.</p>
              </button>
              <button
                type="button"
                onClick={() => setVisibility("private")}
                className={`p-4 rounded-xl border text-left transition-all ${
                  visibility === "private" ? "bg-zinc-700/30 border-zinc-500" : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Lock className="w-4 h-4 text-zinc-400" />
                  <span className="font-bold text-sm text-white">Privada</span>
                  {visibility === "private" && <Check className="w-4 h-4 text-zinc-300 ml-auto" />}
                </div>
                <p className="text-xs text-zinc-500">Solo para ti. No aparece en la biblioteca pública.</p>
              </button>
            </div>

            {/* Portada de la ruta: el agente redacta el prompt de alto impacto */}
            <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-4 mb-4">
              <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold flex items-center gap-1.5 mb-1">
                <LogoMark className="w-3.5 h-3.5" /> Portada de la ruta
              </label>
              <p className="text-xs text-zinc-600 mb-3">
                Di en pocas palabras qué quieres en la portada y la IA redacta el prompt perfecto. Si la dejas vacía, se genera automática.
              </p>

              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <input
                  value={coverIdea}
                  onChange={e => setCoverIdea(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleCraftPrompt(); } }}
                  maxLength={300}
                  placeholder='Ej: "yo enseñando frente a una pizarra", "estilo cómic épico"...'
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 px-3.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={handleCraftPrompt}
                  disabled={craftingPrompt}
                  className="shrink-0 inline-flex items-center justify-center gap-2 bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-60"
                >
                  {craftingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {craftingPrompt ? "Redactando..." : "Redactar con IA"}
                </button>
              </div>

              {coverPrompt && (
                <div className="mb-3">
                  <label className="text-[11px] uppercase tracking-wider text-zinc-600 font-bold">Prompt de la portada (puedes editarlo)</label>
                  <textarea
                    value={coverPrompt}
                    onChange={e => setCoverPrompt(e.target.value)}
                    rows={4}
                    maxLength={1200}
                    className="w-full mt-1 bg-zinc-900 border border-primary/30 rounded-xl p-3 text-xs text-zinc-200 focus:outline-none focus:border-primary resize-none leading-relaxed"
                  />
                </div>
              )}

              {/* Referencia: recomendada si el autor/creador va en la portada */}
              {coverReference ? (
                <div className="flex items-center gap-3">
                  <div className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coverReference} alt="referencia" className="h-16 rounded-lg border border-zinc-700 object-cover" />
                    <button
                      onClick={() => setCoverReference(null)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-zinc-800 border border-zinc-600 rounded-full flex items-center justify-center text-zinc-300 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-xs text-emerald-400/90 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> La IA integrará esta imagen en la portada.</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => coverRefInputRef.current?.click()}
                  className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 border-dashed hover:border-primary rounded-xl px-4 py-3 text-left transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                    <UserRound className="w-5 h-5 text-zinc-500 group-hover:text-primary transition-colors" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-300 flex items-center gap-1.5"><ImagePlus className="w-3.5 h-3.5" /> Imagen de referencia (opcional)</p>
                    <p className="text-xs text-zinc-600">¿Sales tú o el autor del conocimiento en la portada? Sube su foto y la IA la integra.</p>
                  </div>
                </button>
              )}
              <input ref={coverRefInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleCoverReference} />
            </div>

            {genError && <p className="text-rose-400 text-sm mb-3 text-center">{genError}</p>}
            <button
              onClick={handleGenerateKnowledge}
              disabled={isGenerating || !category}
              className="w-full py-4 bg-white text-zinc-950 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all disabled:opacity-70"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Leyendo tus fuentes y construyendo la ruta... (~1 min)
                </>
              ) : (
                <>
                  Generar Ruta de Aprendizaje
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </motion.div>
        )}
      </div>

      {/* Paywall Premium */}
      <AnimatePresence>
        {showPaywall && token && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowPaywall(false)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md relative"
            >
              <button onClick={() => setShowPaywall(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-center justify-center mb-4">
                  <Crown className="w-8 h-8 text-amber-400" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Hazte Premium</h3>
                <p className="text-zinc-400 text-sm">
                  Ya usaste tu ruta gratuita. Con Premium creas hasta <span className="text-white font-semibold">3 rutas</span> con IA.
                  Estudiar la biblioteca siempre es gratis.
                </p>
                <div className="mt-4 text-3xl font-bold text-white">
                  $23.900 <span className="text-base font-normal text-zinc-500">COP · pago único</span>
                </div>
              </div>
              <PremiumCheckout token={token} email={email} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
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
