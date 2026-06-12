"use client";

// Creación de rutas EN LOTE (hasta 20 en paralelo, estilo Video Factory):
// el usuario abre N placeholders, cada uno con sus links, categoría y portada
// opcional (prompt + imagen de referencia), y todas las rutas se generan a la
// vez. Función exclusiva: el admin la activa por usuario (batch_enabled).

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers, Loader2, Plus, X, Link as LinkIcon, ImagePlus,
  Lock, AlertTriangle, Check, ChevronDown, ChevronUp, Rocket, BookOpen, ExternalLink,
} from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { createRouteBatch, getMyRoutes, type BatchRouteInput } from "@/app/routeActions";
import { getPlan } from "@/app/socialActions";
import { fileToResizedDataUrl } from "@/lib/imageUtils";
import { extractUrls } from "@/lib/urlUtils";
import { ROUTE_CATEGORIES, type PlanState, type RouteSummary } from "@/lib/types";
import AppHeader from "@/components/AppHeader";
import { LogoMark } from "@/components/Logo";

const BATCH_MAX = 20;

interface Slot {
  id: number;
  topic: string;
  links: string[];
  linkDraft: string;
  category: string;
  coverOpen: boolean;
  coverPrompt: string;
  coverReference: string | null; // base64 (data URL)
}

function emptySlot(id: number): Slot {
  return { id, topic: "", links: [], linkDraft: "", category: "", coverOpen: false, coverPrompt: "", coverReference: null };
}

export default function BatchPage() {
  const router = useRouter();
  const { token, loading, session } = useRequireAuth();

  const [plan, setPlan] = useState<PlanState | null>(null);
  const [planLoaded, setPlanLoaded] = useState(false);

  // setup | progress
  const [phase, setPhase] = useState<"setup" | "progress">("setup");
  const [count, setCount] = useState(2);
  const [slots, setSlots] = useState<Slot[]>([emptySlot(0), emptySlot(1)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // progreso
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<RouteSummary[]>([]);
  const refFileInputs = useRef<Map<number, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!token) return;
    getPlan(token).then(p => { setPlan(p); setPlanLoaded(true); });
  }, [token]);

  const remaining = plan ? Math.max(0, plan.routeQuota - plan.routesUsed) : 0;
  const maxCount = Math.min(BATCH_MAX, remaining);

  // Ajustar el número de placeholders al contador elegido
  const applyCount = (n: number) => {
    const clamped = Math.max(1, Math.min(maxCount || 1, n));
    setCount(clamped);
    setSlots(prev => {
      if (clamped <= prev.length) return prev.slice(0, clamped);
      const extra = Array.from({ length: clamped - prev.length }, (_, i) => emptySlot(prev.length + i));
      return [...prev, ...extra];
    });
  };

  const patchSlot = (id: number, patch: Partial<Slot>) =>
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));

  const addLink = (slot: Slot) => {
    const v = slot.linkDraft.trim();
    if (!v) return;
    // Si el campo trae varias URLs (pegadas juntas), se agregan todas
    const urls = extractUrls(v);
    const nuevos = (urls.length > 0 ? urls : [v]).filter(u => !slot.links.includes(u));
    patchSlot(slot.id, { links: [...slot.links, ...nuevos], linkDraft: "" });
  };

  /** Pegar varias URLs a la vez en un placeholder: quedan listas, sin generar. */
  const handleLinkPaste = (slot: Slot, e: React.ClipboardEvent<HTMLInputElement>) => {
    const urls = extractUrls(e.clipboardData.getData("text"));
    if (urls.length >= 2) {
      e.preventDefault();
      const nuevos = urls.filter(u => !slot.links.includes(u));
      patchSlot(slot.id, { links: [...slot.links, ...nuevos], linkDraft: "" });
    }
  };

  const handleReference = async (slotId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const base64 = await fileToResizedDataUrl(file, 1024, 1024);
      patchSlot(slotId, { coverReference: base64 });
    } catch {
      setError("No se pudo leer la imagen de referencia.");
    }
  };

  const validSlots = slots.filter(s => s.topic.trim() && s.links.length > 0 && s.category);
  const allValid = validSlots.length === slots.length;

  const handleGenerate = async () => {
    if (!token || !allValid || submitting) return;
    setSubmitting(true);
    setError("");
    const items: BatchRouteInput[] = slots.map(s => ({
      topic: s.topic.trim(),
      sources: s.links.join(","),
      category: s.category,
      coverPrompt: s.coverPrompt.trim() || undefined,
      coverReference: s.coverReference ?? undefined,
    }));
    try {
      const res = await createRouteBatch(token, items);
      if (res.ok && res.routeIds) {
        setBatchIds(res.routeIds);
        setPhase("progress");
      } else if (res.quotaReached) {
        setError("El lote no cabe en tu cuota de rutas. Reduce la cantidad.");
      } else {
        setError(res.error || "No se pudo crear el lote.");
      }
    } catch {
      setError("Error de conexión al crear el lote.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Polling del progreso (patrón Video Factory) ──
  const pollJobs = useCallback(async () => {
    if (!token || batchIds.length === 0) return;
    const all = await getMyRoutes(token);
    setJobs(batchIds.map(id => all.find(r => r.id === id)).filter((r): r is RouteSummary => Boolean(r)));
  }, [token, batchIds]);

  useEffect(() => {
    if (phase !== "progress" || batchIds.length === 0) return;
    pollJobs();
    const interval = setInterval(() => {
      // Dejar de hacer polling cuando todo terminó
      setJobs(prev => {
        const done = prev.length === batchIds.length && prev.every(j => j.status === "ready" || j.status === "error");
        if (!done) pollJobs();
        return prev;
      });
    }, 8000);
    return () => clearInterval(interval);
  }, [phase, batchIds, pollJobs]);

  if (loading || !session || !planLoaded) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>;
  }

  // ── Gate: función exclusiva ──
  if (!plan?.batchEnabled) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <AppHeader />
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <div className="w-16 h-16 bg-violet-500/10 border border-violet-500/40 rounded-2xl flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Función exclusiva</h1>
          <p className="text-zinc-500 mb-6 max-w-md">
            La creación de rutas en lote es una función especial que el administrador activa manualmente. Si la necesitas, contáctalo.
          </p>
          <button onClick={() => router.push("/")} className="px-6 py-3 rounded-2xl bg-primary text-white font-bold">Volver al inicio</button>
        </div>
      </main>
    );
  }

  // ── Vista de progreso: grid de jobs ──
  if (phase === "progress") {
    const readyCount = jobs.filter(j => j.status === "ready").length;
    const errorCount = jobs.filter(j => j.status === "error").length;
    const done = jobs.length === batchIds.length && readyCount + errorCount === batchIds.length;

    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <AppHeader />
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/40 flex items-center justify-center">
              <Layers className="w-5 h-5 text-violet-400" />
            </div>
            <h1 className="text-3xl font-bold">Lote en producción</h1>
          </div>
          <p className="text-zinc-500 mb-8">
            {done
              ? `Lote terminado: ${readyCount} rutas listas${errorCount ? ` · ${errorCount} con error` : ""}.`
              : `Tus ${batchIds.length} rutas se están generando en paralelo. Puedes salir: el proceso sigue solo.`}
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(jobs.length ? jobs : batchIds.map((id, i) => ({ id, topic: `Ruta ${i + 1}`, status: "generating", totalNodes: 0, readyNodes: 0 } as unknown as RouteSummary))).map(j => {
              const pct = j.totalNodes > 0 ? Math.round((j.readyNodes / j.totalNodes) * 100) : 0;
              return (
                <motion.div
                  key={j.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-bold text-sm leading-snug line-clamp-2">{j.topic}</h3>
                    {j.status === "ready" ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                        <Check className="w-3 h-3" /> Lista
                      </span>
                    ) : j.status === "error" ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-full px-2 py-0.5">
                        <AlertTriangle className="w-3 h-3" /> Error
                      </span>
                    ) : (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> Generando
                      </span>
                    )}
                  </div>

                  {j.status !== "error" && (
                    <>
                      <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
                        <span>{j.totalNodes > 0 ? `${j.readyNodes}/${j.totalNodes} lecciones` : "Construyendo el árbol..."}</span>
                        <span>{j.totalNodes > 0 ? `${pct}%` : ""}</span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-3">
                        <div
                          className={`h-full transition-all duration-700 ${j.status === "ready" ? "bg-emerald-500" : "bg-gradient-to-r from-violet-500 to-primary"}`}
                          style={{ width: j.totalNodes > 0 ? `${pct}%` : "8%" }}
                        />
                      </div>
                    </>
                  )}

                  <button
                    onClick={() => router.push(`/route/${j.id}`)}
                    className="w-full inline-flex items-center justify-center gap-2 text-xs font-bold rounded-xl py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Ver ruta
                  </button>
                </motion.div>
              );
            })}
          </div>

          <div className="flex justify-center gap-3 mt-10">
            <button onClick={() => router.push("/")} className="px-6 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-bold hover:border-zinc-700 transition-all">
              Ir al inicio
            </button>
            {done && (
              <button
                onClick={() => { setPhase("setup"); setBatchIds([]); setJobs([]); setSlots([emptySlot(0), emptySlot(1)]); setCount(2); }}
                className="px-6 py-3 rounded-2xl bg-violet-500/15 border border-violet-500/50 text-violet-300 font-bold hover:bg-violet-500/25 transition-all"
              >
                Crear otro lote
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ── Vista de configuración ──
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AppHeader />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/40 flex items-center justify-center">
            <Layers className="w-5 h-5 text-violet-400" />
          </div>
          <h1 className="text-3xl font-bold">Crear rutas en lote</h1>
        </div>
        <p className="text-zinc-500 mb-6">
          Configura cada ruta con sus links (web, YouTube o archivos) y genera todas a la vez.
          Te quedan <span className="text-white font-bold">{remaining}</span> rutas de cuota.
        </p>

        {maxCount === 0 ? (
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="text-zinc-300 font-bold mb-1">No te queda cuota de rutas</p>
            <p className="text-zinc-500 text-sm">Pide más cuota al administrador o libera espacio eliminando rutas.</p>
          </div>
        ) : (
          <>
            {/* Selector de cantidad */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-4">
              <label className="text-sm font-bold text-zinc-300">¿Cuántas rutas vas a crear?</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={maxCount}
                  value={count}
                  onChange={e => applyCount(parseInt(e.target.value, 10))}
                  className="w-44 accent-violet-500"
                />
                <span className="w-12 text-center text-lg font-bold text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-lg py-1">
                  {count}
                </span>
              </div>
              <span className="text-xs text-zinc-600">máx. {maxCount} (cuota) · tope {BATCH_MAX}</span>
            </div>

            {/* Placeholders */}
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <AnimatePresence>
                {slots.map((s, i) => {
                  const valid = s.topic.trim() && s.links.length > 0 && s.category;
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      className={`bg-zinc-900/80 border rounded-2xl p-5 ${valid ? "border-emerald-500/40" : "border-zinc-800"}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-violet-400">Ruta {i + 1}</span>
                        {valid && <Check className="w-4 h-4 text-emerald-400" />}
                      </div>

                      {/* Tema */}
                      <input
                        value={s.topic}
                        onChange={e => patchSlot(s.id, { topic: e.target.value })}
                        maxLength={140}
                        placeholder="Tema de la ruta (ej: Marketing de contenidos)"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2.5 px-3.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 mb-3"
                      />

                      {/* Links */}
                      <div className="mb-3">
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                            <input
                              value={s.linkDraft}
                              onChange={e => patchSlot(s.id, { linkDraft: e.target.value })}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink(s); } }}
                              onPaste={e => handleLinkPaste(s, e)}
                              placeholder="https://... (puedes pegar varias a la vez)"
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-secondary"
                            />
                          </div>
                          <button
                            onClick={() => addLink(s)}
                            disabled={!s.linkDraft.trim()}
                            className="shrink-0 w-10 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 flex items-center justify-center text-zinc-300"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        {s.links.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {s.links.map((l, li) => (
                              <li key={li} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs">
                                <LinkIcon className="w-3 h-3 text-secondary shrink-0" />
                                <span className="truncate flex-1 text-zinc-300">{l}</span>
                                <button
                                  onClick={() => patchSlot(s.id, { links: s.links.filter((_, x) => x !== li) })}
                                  className="text-zinc-600 hover:text-rose-400"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Categoría */}
                      <select
                        value={s.category}
                        onChange={e => patchSlot(s.id, { category: e.target.value })}
                        className={`w-full bg-zinc-950 border rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:border-violet-500 mb-3 ${
                          s.category ? "border-zinc-800 text-white" : "border-amber-500/40 text-zinc-500"
                        }`}
                      >
                        <option value="">Elige la categoría...</option>
                        {ROUTE_CATEGORIES.map(c => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>

                      {/* Portada opcional */}
                      <button
                        onClick={() => patchSlot(s.id, { coverOpen: !s.coverOpen })}
                        className="w-full flex items-center justify-between text-xs font-bold text-zinc-400 hover:text-white transition-colors py-1"
                      >
                        <span className="inline-flex items-center gap-1.5"><LogoMark className="w-3.5 h-3.5" /> Portada personalizada (opcional)</span>
                        {s.coverOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {s.coverOpen && (
                        <div className="mt-2 bg-zinc-950/70 border border-zinc-800 rounded-xl p-3">
                          <textarea
                            value={s.coverPrompt}
                            onChange={e => patchSlot(s.id, { coverPrompt: e.target.value })}
                            rows={2}
                            maxLength={600}
                            placeholder="Prompt de la portada (si lo dejas vacío, la IA usa uno automático)..."
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none mb-2"
                          />
                          {s.coverReference ? (
                            <div className="relative inline-block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={s.coverReference} alt="referencia" className="h-14 rounded-md border border-zinc-700 object-cover" />
                              <button
                                onClick={() => patchSlot(s.id, { coverReference: null })}
                                className="absolute -top-2 -right-2 w-5 h-5 bg-zinc-800 border border-zinc-600 rounded-full flex items-center justify-center text-zinc-300 hover:text-white"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => refFileInputs.current.get(s.id)?.click()}
                              className="inline-flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 border-dashed hover:border-primary text-zinc-500 hover:text-white rounded-lg px-3 py-1.5 text-xs transition-all"
                            >
                              <ImagePlus className="w-3.5 h-3.5" /> Imagen de referencia
                            </button>
                          )}
                          <input
                            ref={el => { if (el) refFileInputs.current.set(s.id, el); }}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={e => handleReference(s.id, e)}
                          />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {error && <p className="text-rose-400 text-sm mb-4 text-center">{error}</p>}

            <button
              onClick={handleGenerate}
              disabled={!allValid || submitting}
              className="w-full py-4 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-all"
            >
              {submitting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Despachando el lote...</>
              ) : (
                <><Rocket className="w-5 h-5" /> Generar {count} {count === 1 ? "ruta" : "rutas"} en paralelo</>
              )}
            </button>
            {!allValid && (
              <p className="text-center text-xs text-zinc-600 mt-2">
                <BookOpen className="w-3.5 h-3.5 inline mr-1" />
                Cada ruta necesita tema, al menos un link y categoría ({validSlots.length}/{slots.length} listas).
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
