"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Megaphone, Search, RefreshCw, Check, AlertTriangle, Sparkles, Send,
  ChevronDown, ChevronUp, Eye, Clock, Square, CheckSquare, StopCircle, Trash2,
  X, FilePlus2, Save, BookOpen, User as UserIcon, Mail, Target, GraduationCap,
} from "lucide-react";
import {
  ucGetConfig, ucListCampaigns, ucSaveCampaign, ucDeleteCampaign, ucGenerateWithGemini,
  ucListUsers, ucSendOne, ucListRoutes,
  type UcConfig, type CampaignRow, type UcUserRow, type UcListFilters, type RouteState,
  type RouteCatalogRow, type RouteAudienceStats, type SuggestedSegment,
} from "@/app/userCampaignsActions";
import { adminGetSignature } from "@/app/emailActions";
import { renderUserTemplate, type UserMergeVars } from "@/lib/crm/render";

// Mismo throttle que el CRM de creadores: pausa aleatoria entre envíos.
const THROTTLE_MIN_MS = 12_000;
const THROTTLE_MAX_MS = 35_000;
const randomDelay = () => THROTTLE_MIN_MS + Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS);
const PAGE = 60;

function bodyToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escaped}</div>`;
}

const MERGE_HINT = "{{nombre}}, {{curso}}, {{progreso}}, {{enlace}}";
const STATE_LABEL: Record<RouteState, string> = { in_progress: "En progreso", completed: "Completaron", not_started: "Sin empezar" };

export default function UserCampaignsTab({ token }: { token: string | null }) {
  const [config, setConfig] = useState<UcConfig | null>(null);
  const [signature, setSignature] = useState("");
  const [origin, setOrigin] = useState("");
  const [routes, setRoutes] = useState<RouteCatalogRow[]>([]);

  // Biblioteca de campañas + editor
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [targetRouteId, setTargetRouteId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorMsg, setEditorMsg] = useState("");
  const [confirmDelCampaign, setConfirmDelCampaign] = useState<string | null>(null);

  // Generación con IA
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [showAi, setShowAi] = useState(false);

  // Usuarios / audiencia
  const [users, setUsers] = useState<UcUserRow[]>([]);
  const usersRef = useRef<UcUserRow[]>([]);
  const consumedRef = useRef(0); // cuántos ids del universo llevamos pedidos (para paginar)
  const [allMatchedIds, setAllMatchedIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<RouteAudienceStats | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filtros
  const [fSearch, setFSearch] = useState("");
  const [fOnlyInProgress, setFOnlyInProgress] = useState(true);
  const [routeState, setRouteState] = useState<"all" | RouteState>("all");
  const [minPct, setMinPct] = useState<string>("");
  const [maxPct, setMaxPct] = useState<string>("");
  const [completedWithinDays, setCompletedWithinDays] = useState<string>("");

  // Selección + envío
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingBatch, setSendingBatch] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchMsg, setBatchMsg] = useState("");
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const stopRef = useRef(false);

  useEffect(() => { if (typeof window !== "undefined") setOrigin(window.location.origin); }, []);

  const dirty = selectedCampaignId
    ? (() => {
        const c = campaigns.find(x => x.id === selectedCampaignId);
        return !c || c.name !== name || c.subject !== subject || c.body !== body || (c.targetRouteId || "") !== targetRouteId;
      })()
    : Boolean(name || subject || body || targetRouteId);

  const campaignUsesCourse = /\{\{\s*(curso|enlace|progreso)\s*\}\}/.test(subject + body);
  const routeLink = (id: string) => `${origin}/route/${id}`;
  const targetTopic = routes.find(r => r.id === targetRouteId)?.topic || "";

  const setUsersBoth = (rows: UcUserRow[]) => { usersRef.current = rows; setUsers(rows); };

  const loadUsers = useCallback(async (replace: boolean) => {
    if (!token) return;
    setLoadingUsers(true);
    const offset = replace ? 0 : consumedRef.current;
    consumedRef.current = offset + PAGE;
    const filters: UcListFilters = {
      search: fSearch,
      onlyInProgress: fOnlyInProgress,
      campaignId: selectedCampaignId || undefined,
      targetRouteId: targetRouteId || undefined,
      routeState,
      minPct: minPct === "" ? undefined : Number(minPct),
      maxPct: maxPct === "" ? undefined : Number(maxPct),
      completedWithinDays: completedWithinDays === "" ? undefined : Number(completedWithinDays),
      offset,
      limit: PAGE,
    };
    const res = await ucListUsers(token, filters);
    setUsersBoth(replace ? res.rows : [...usersRef.current, ...res.rows]);
    setAllMatchedIds(res.allMatchedIds);
    setTotal(res.total);
    setStats(res.stats);
    setLoadingUsers(false);
  }, [token, fSearch, fOnlyInProgress, selectedCampaignId, targetRouteId, routeState, minPct, maxPct, completedWithinDays]);

  const loadConfig = useCallback(async () => {
    if (!token) return;
    setConfig(await ucGetConfig(token));
  }, [token]);
  const loadCampaigns = useCallback(async () => {
    if (!token) return;
    setCampaigns(await ucListCampaigns(token));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadConfig();
    loadCampaigns();
    ucListRoutes(token).then(setRoutes);
    adminGetSignature(token).then(setSignature);
  }, [token, loadConfig, loadCampaigns]);

  // Recarga la audiencia al cambiar ruta objetivo, estado o el modo auto.
  useEffect(() => {
    if (token && config?.tablesReady) { setSelected(new Set()); loadUsers(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, config?.tablesReady, targetRouteId, routeState, fOnlyInProgress, selectedCampaignId]);

  // ── Editor ──
  const newCampaign = () => {
    setSelectedCampaignId(null); setName(""); setSubject(""); setBody(""); setTargetRouteId("");
    setEditorMsg(""); setAiMsg("");
  };
  const selectCampaign = (c: CampaignRow) => {
    setSelectedCampaignId(c.id); setName(c.name); setSubject(c.subject); setBody(c.body);
    setTargetRouteId(c.targetRouteId || "");
    setEditorMsg(""); setAiMsg(""); setSelected(new Set());
  };
  const save = async () => {
    if (!token) return;
    setSaving(true); setEditorMsg("");
    const res = await ucSaveCampaign(token, {
      id: selectedCampaignId || undefined, name, subject, body, targetRouteId: targetRouteId || null,
    });
    setSaving(false);
    if (!res.ok) { setEditorMsg(res.error || "No se pudo guardar."); return; }
    setSelectedCampaignId(res.id || selectedCampaignId);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    await loadCampaigns();
  };
  const doDeleteCampaign = async (id: string) => {
    if (!token) return;
    const res = await ucDeleteCampaign(token, id);
    if (res.ok) { setConfirmDelCampaign(null); if (selectedCampaignId === id) newCampaign(); await loadCampaigns(); }
  };

  const generate = async () => {
    if (!token || !aiPrompt.trim()) return;
    setAiBusy(true); setAiMsg("");
    const res = await ucGenerateWithGemini(token, {
      prompt: aiPrompt,
      currentSubject: subject || undefined,
      currentBody: body || undefined,
      targetRouteId: targetRouteId || undefined,
      audienceFilters: targetRouteId
        ? { state: routeState, minPct: minPct === "" ? undefined : Number(minPct), maxPct: maxPct === "" ? undefined : Number(maxPct), completedWithinDays: completedWithinDays === "" ? undefined : Number(completedWithinDays) }
        : undefined,
    });
    setAiBusy(false);
    if (!res.ok) { setAiMsg(res.error || "No se pudo generar."); return; }
    setSubject(res.subject || ""); setBody(res.body || "");
    if (res.suggestedName && !name.trim()) setName(res.suggestedName);
    if (res.suggestedSegment) {
      applySegment(res.suggestedSegment);
      setAiMsg("La IA sugirió un segmento (aplicado abajo) — revísalo y aprueba antes de enviar.");
    } else {
      setAiMsg("Listo: revisa el correo y ajústalo antes de guardar.");
    }
  };

  const applySegment = (seg: SuggestedSegment) => {
    if (seg.targetRouteId) setTargetRouteId(seg.targetRouteId);
    setRouteState(seg.state && seg.state !== "all" ? seg.state : "all");
    setMinPct(seg.minPct != null ? String(seg.minPct) : "");
    setMaxPct(seg.maxPct != null ? String(seg.maxPct) : "");
    setCompletedWithinDays(seg.completedWithinDays != null ? String(seg.completedWithinDays) : "");
  };

  // ── Selección + envío ──
  const toggleSel = (id: string) =>
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAllFiltered = () => setSelected(new Set(allMatchedIds));
  const clearSel = () => setSelected(new Set());

  const runBatch = async (ids: string[]) => {
    if (!token || !selectedCampaignId || ids.length === 0) return;
    setSendingBatch(true); stopRef.current = false; setBatchMsg(""); setRowMsg({});
    let sent = 0; let finalMsg = "";
    for (let i = 0; i < ids.length; i++) {
      if (stopRef.current) { finalMsg = `Detenido. Enviados ${sent} de ${ids.length}.`; break; }
      setProgress({ current: i + 1, total: ids.length });
      const res = await ucSendOne(token, selectedCampaignId, ids[i]);
      if (res.capReached) { finalMsg = `Tope diario alcanzado. Enviados ${sent}. Sigue mañana.`; break; }
      if (res.ok) sent++;
      else setRowMsg(m => ({ ...m, [ids[i]]: res.error || "Falló el envío." }));
      if (i < ids.length - 1 && !stopRef.current) await new Promise(r => setTimeout(r, randomDelay()));
    }
    setBatchMsg(finalMsg || `Listo. Enviados ${sent} de ${ids.length}.`);
    setSendingBatch(false); setProgress(null); clearSel();
    loadConfig(); loadUsers(true);
  };
  const sendSelected = () => runBatch([...selected]);

  // ── Preview (editor) ──
  const sample = users[0] || null;
  const previewVars: UserMergeVars = targetRouteId
    ? {
        nombre: sample?.name || "Juan",
        curso: targetTopic || "la ruta",
        progreso: sample?.targetPct != null ? `${sample.targetPct}%` : "40%",
        enlace: origin ? routeLink(targetRouteId) : "https://learnfactory…/route/…",
      }
    : {
        nombre: sample?.name || "Juan",
        curso: sample?.suggested?.topic || "Fundamentos de Teología",
        progreso: sample?.suggested ? `${sample.suggested.completionPct}%` : "35%",
        enlace: sample?.suggested?.link || "https://learnfactory…/route/…",
      };
  const previewSubject = renderUserTemplate(subject, previewVars);
  const previewHtml = bodyToHtml(renderUserTemplate(body, previewVars)) + signature;

  const rowVars = (u: UcUserRow): UserMergeVars => targetRouteId
    ? { nombre: u.name, curso: targetTopic, progreso: u.targetPct != null ? `${u.targetPct}%` : "", enlace: routeLink(targetRouteId) }
    : { nombre: u.name, curso: u.suggested?.topic || "", progreso: u.suggested ? `${u.suggested.completionPct}%` : "", enlace: u.suggested?.link || "" };

  if (!config) {
    return <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando campañas…</div>;
  }

  const hasMore = consumedRef.current < total;

  return (
    <>
      {/* Estado / config */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Megaphone className="w-4 h-4 text-primary" />
          <h2 className="font-bold">Campañas a usuarios</h2>
        </div>
        <p className="text-sm text-zinc-500 mb-3">
          Redacta un correo (a mano o con <span className="text-zinc-300">IA</span>, que lee el contenido de la ruta),
          guárdalo con un nombre, segmenta por ruta / avance / tiempo y envíalo en lote. Misma firma, dirección y pausas del panel.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.resendConfigured ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}>
            {config.resendConfigured ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {config.resendConfigured ? `Envío listo (${config.fromAddress})` : "Faltan RESEND_API_KEY / EMAIL_FROM"}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.geminiReady ? "bg-violet-500/15 text-violet-300 border-violet-500/40" : "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
            <Sparkles className="w-3 h-3" /> {config.geminiReady ? "IA conectada" : "Sin GEMINI_API_KEY"}
          </span>
          {!config.tablesReady && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-500/10 text-amber-300 border-amber-500/40">
              <AlertTriangle className="w-3 h-3" /> Faltan tablas — corre scripts/user-campaigns-setup.sql
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-zinc-800 text-zinc-400 border-zinc-700">
            <Clock className="w-3 h-3" /> Hoy: {config.sentToday}/{config.dailyCap} enviados
          </span>
        </div>
      </div>

      {/* Biblioteca de campañas */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={newCampaign}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-bold border transition-all ${!selectedCampaignId ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"}`}
        >
          <FilePlus2 className="w-4 h-4" /> Nueva
        </button>
        {campaigns.map(c => (
          <div key={c.id} className={`inline-flex items-center rounded-2xl border ${selectedCampaignId === c.id ? "bg-primary/15 border-primary/40" : "bg-zinc-900 border-zinc-800"}`}>
            <button onClick={() => selectCampaign(c)} className={`pl-3 pr-2 py-2 text-sm font-bold ${selectedCampaignId === c.id ? "text-primary" : "text-zinc-400 hover:text-white"}`}>
              {c.name}{c.targetRouteId && <Target className="inline w-3 h-3 ml-1 -mt-0.5" />}
            </button>
            {confirmDelCampaign === c.id ? (
              <span className="flex items-center pr-1">
                <button onClick={() => doDeleteCampaign(c.id)} title="Confirmar" className="w-7 h-7 rounded-lg text-rose-300 hover:bg-rose-500/20 flex items-center justify-center"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setConfirmDelCampaign(null)} title="Cancelar" className="w-7 h-7 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
              </span>
            ) : (
              <button onClick={() => setConfirmDelCampaign(c.id)} title="Borrar campaña" className="w-7 h-7 mr-1 rounded-lg text-zinc-500 hover:text-rose-400 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
      </div>

      {/* Editor + preview */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">Nombre de la campaña</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder='"Retomar teología v1"'
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 flex items-center gap-1"><Target className="w-3 h-3" /> Ruta objetivo</label>
              <select value={targetRouteId} onChange={e => setTargetRouteId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-2 text-sm text-white focus:outline-none focus:border-primary">
                <option value="">Sin ruta (auto por usuario)</option>
                {routes.map(r => <option key={r.id} value={r.id}>{r.topic} ({r.studentCount})</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Asunto</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="{{nombre}}, te falta poco en {{curso}}…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Cuerpo (merge fields: {MERGE_HINT})</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={9}
              placeholder={`Hola {{nombre}},\n\nVi que vas en {{progreso}} de "{{curso}}". Te falta poquito.\n\nRetómalo aquí:\n{{enlace}}`}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-zinc-200 focus:outline-none focus:border-primary resize-y" />
          </div>

          {/* Generar con IA */}
          <div className="border-t border-zinc-800 pt-2.5">
            <button onClick={() => setShowAi(v => !v)} className="inline-flex items-center gap-1.5 text-sm font-bold text-violet-300 hover:text-violet-200">
              <Sparkles className="w-4 h-4" /> Generar con IA {showAi ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <AnimatePresence>
              {showAi && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] text-zinc-500">
                      Instrucción abierta. Ej: <span className="text-zinc-400">&quot;campaña sobre esta ruta con contenido de valor&quot;</span> o{" "}
                      <span className="text-zinc-400">&quot;premio a quienes terminaron la ruta de X en menos de 7 días&quot;</span>. Si no eliges ruta, la IA puede proponer el segmento.
                    </p>
                    <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3}
                      placeholder="¿Qué correo quieres? La IA lee la síntesis de la ruta objetivo (si la hay) y los datos de avance."
                      className="w-full bg-zinc-950 border border-violet-500/30 rounded-xl py-2 px-3 text-sm text-zinc-200 focus:outline-none focus:border-violet-500 resize-y" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={generate} disabled={aiBusy || !aiPrompt.trim() || !config.geminiReady}
                        title={config.geminiReady ? "Redactar con IA" : "Falta GEMINI_API_KEY"}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500/20 text-violet-200 border border-violet-500/40 font-bold text-sm hover:bg-violet-500/30 transition-all disabled:opacity-50">
                        {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {subject || body ? "Generar / mejorar" : "Generar"}
                      </button>
                      {aiMsg && <span className="text-xs text-zinc-400">{aiMsg}</span>}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving || !dirty}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm transition-all disabled:opacity-40 ${saved ? "bg-emerald-500 text-emerald-950" : "bg-primary text-white hover:bg-primary-hover"}`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {selectedCampaignId ? "Guardar cambios" : "Guardar campaña"}
            </button>
            {dirty && <span className="text-xs text-amber-400/80">cambios sin guardar</span>}
            {editorMsg && <span className="text-xs text-rose-400">{editorMsg}</span>}
          </div>
        </div>

        {/* Preview */}
        <div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
            <Eye className="w-3.5 h-3.5" /> Preview {targetRouteId ? `(ruta: ${targetTopic})` : sample?.suggested ? `(con ${sample.name})` : "(ejemplo)"}
          </div>
          <div className="rounded-xl border border-zinc-800 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-200 bg-zinc-50">
              <p className="text-[11px] text-zinc-500">Para: {sample?.email || "usuario@ejemplo.com"}</p>
              <p className="text-sm font-bold text-zinc-900 truncate">{previewSubject || "(asunto vacío)"}</p>
            </div>
            <div className="p-4 max-h-[420px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>

      {/* ── Usuarios / audiencia ── */}
      <div className="flex items-center gap-2 mb-3">
        <Mail className="w-4 h-4 text-primary" />
        <h3 className="font-bold">{targetRouteId ? `Audiencia · ${targetTopic}` : "Usuarios registrados"}</h3>
        {!selectedCampaignId && <span className="text-xs text-amber-400/80">— guarda o selecciona una campaña para enviar</span>}
      </div>

      {/* Stats de audiencia (modo ruta objetivo) */}
      {targetRouteId && stats && (
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            { k: "Total", v: stats.total },
            { k: "En progreso", v: stats.inProgress },
            { k: "Completaron", v: stats.completed },
            { k: "Sin empezar", v: stats.notStarted },
            { k: "Avance prom.", v: `${stats.avgPct}%` },
            { k: "Terminaron rápido", v: stats.completedFast },
          ].map(s => (
            <span key={s.k} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs border bg-zinc-900 border-zinc-800 text-zinc-300">
              <span className="text-zinc-500">{s.k}:</span> <span className="font-bold text-white">{s.v}</span>
            </span>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {targetRouteId ? (
          <>
            {(["all", "in_progress", "completed", "not_started"] as const).map(st => (
              <button key={st} onClick={() => setRouteState(st)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-bold border transition-all ${routeState === st ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"}`}>
                {st === "completed" && <GraduationCap className="w-3.5 h-3.5" />}
                {st === "all" ? "Todos" : STATE_LABEL[st]}
              </button>
            ))}
            <div className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <span>%</span>
              <input value={minPct} onChange={e => setMinPct(e.target.value.replace(/\D/g, ""))} placeholder="min" className="w-12 bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2 text-center text-white focus:outline-none focus:border-primary" />
              <span>–</span>
              <input value={maxPct} onChange={e => setMaxPct(e.target.value.replace(/\D/g, ""))} placeholder="max" className="w-12 bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2 text-center text-white focus:outline-none focus:border-primary" />
            </div>
            <div className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <GraduationCap className="w-3.5 h-3.5" /> terminó en ≤
              <input value={completedWithinDays} onChange={e => setCompletedWithinDays(e.target.value.replace(/\D/g, ""))} placeholder="días" className="w-14 bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2 text-center text-white focus:outline-none focus:border-primary" /> días
            </div>
            <button onClick={() => loadUsers(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-bold bg-zinc-800 text-zinc-200 hover:text-white transition-all">
              Aplicar
            </button>
          </>
        ) : (
          <button onClick={() => setFOnlyInProgress(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-sm font-bold border transition-all ${fOnlyInProgress ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"}`}>
            <BookOpen className="w-4 h-4" /> Solo con curso a medias
          </button>
        )}
        <form onSubmit={e => { e.preventDefault(); loadUsers(true); }} className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="Buscar por correo o usuario…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-2.5 pl-11 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary" />
        </form>
        <button onClick={() => loadUsers(true)} title="Actualizar" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Barra de acciones de lote */}
      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3">
          <button onClick={selectAllFiltered} className="text-xs text-zinc-400 hover:text-white font-bold">Seleccionar todos ({total})</button>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-zinc-500">· {selected.size} seleccionados</span>
              <button onClick={clearSel} className="text-xs text-zinc-500 hover:text-white">limpiar</button>
            </>
          )}
          <button onClick={sendSelected} disabled={sendingBatch || !selectedCampaignId || selected.size === 0}
            title={!selectedCampaignId ? "Guarda o selecciona una campaña primero" : "Enviar a los seleccionados"}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all disabled:opacity-50">
            {sendingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar lote ({selected.size})
          </button>
        </div>
      )}

      {/* Progreso */}
      {sendingBatch && progress && (
        <div className="flex items-center gap-3 mb-4 bg-primary/10 border border-primary/30 rounded-2xl p-3">
          <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
          <span className="text-sm text-zinc-200">Enviando {progress.current} de {progress.total}… (con pausas para cuidar la reputación)</span>
          <button onClick={() => { stopRef.current = true; }} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white text-xs font-bold">
            <StopCircle className="w-3.5 h-3.5" /> Detener
          </button>
        </div>
      )}
      {batchMsg && !sendingBatch && <p className="text-sm text-zinc-300 mb-4">{batchMsg}</p>}

      {/* Lista */}
      {loadingUsers && users.length === 0 ? (
        <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando usuarios…</div>
      ) : users.length === 0 ? (
        <p className="text-zinc-500 py-10 text-center">
          {targetRouteId ? "Ningún usuario cumple estos filtros en la ruta." : fOnlyInProgress ? "Ningún usuario tiene un curso a medias." : "No se encontraron usuarios."}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {users.map(u => {
              const isOpen = expanded === u.id;
              const selectable = Boolean(targetRouteId) || !campaignUsesCourse || Boolean(u.suggested);
              const rv = rowVars(u);
              return (
                <div key={u.id} className={`bg-zinc-900/80 border rounded-2xl overflow-hidden ${selected.has(u.id) ? "border-primary/40" : "border-zinc-800"}`}>
                  <div className="p-4 flex items-center gap-3">
                    {selectable ? (
                      <button onClick={() => toggleSel(u.id)} className="shrink-0 text-primary">
                        {selected.has(u.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-zinc-600" />}
                      </button>
                    ) : <span className="shrink-0 w-5" />}
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : <UserIcon className="w-5 h-5 text-zinc-500" />}
                    </div>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(isOpen ? null : u.id)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white truncate">{u.name}</span>
                        {u.alreadySent && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border bg-sky-500/15 text-sky-300 border-sky-500/40">ya enviado</span>}
                        {targetRouteId && u.targetState && (
                          <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${u.targetState === "completed" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : u.targetState === "in_progress" ? "bg-amber-500/15 text-amber-300 border-amber-500/40" : "bg-zinc-700/40 text-zinc-400 border-zinc-600"}`}>
                            {STATE_LABEL[u.targetState]}
                          </span>
                        )}
                        {!targetRouteId && !u.suggested && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border bg-zinc-700/40 text-zinc-400 border-zinc-600">sin curso a medias</span>}
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {u.email}
                        {targetRouteId
                          ? u.targetPct != null && <> · {targetTopic}: {u.targetPct}%</>
                          : u.suggested && <> · <span className="text-zinc-400">{u.suggested.topic}</span> · {u.suggested.completionPct}%</>}
                      </p>
                    </div>
                    {selectedCampaignId && (
                      <button onClick={() => runBatch([u.id])} disabled={sendingBatch || !selectable}
                        title="Enviar solo a este usuario" className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-primary/20 text-zinc-300 hover:text-primary text-xs font-bold transition-all disabled:opacity-40">
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => setExpanded(isOpen ? null : u.id)} className="shrink-0 text-zinc-500 hover:text-white">
                      {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-zinc-800">
                        <div className="p-4 space-y-3">
                          <div>
                            <p className="text-xs text-zinc-500 mb-1.5">Progreso por ruta ({u.allRoutes.length})</p>
                            {u.allRoutes.length === 0 ? (
                              <p className="text-xs text-zinc-600">No ha empezado ninguna ruta.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {u.allRoutes.map(c => {
                                  const isTarget = targetRouteId === c.routeId;
                                  return (
                                    <div key={c.routeId} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${isTarget ? "border-primary/40 bg-primary/5" : c.completionPct >= 100 ? "border-emerald-500/20 bg-emerald-500/5" : "border-zinc-800 bg-zinc-950/40"}`}>
                                      <BookOpen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                      <span className="text-sm text-zinc-200 truncate flex-1">{c.topic}</span>
                                      {isTarget && <span className="text-[10px] uppercase font-bold text-primary">objetivo</span>}
                                      <div className="w-24 h-1.5 rounded-full bg-zinc-800 overflow-hidden shrink-0">
                                        <div className={`h-full ${c.completionPct >= 100 ? "bg-emerald-400" : "bg-primary"}`} style={{ width: `${c.completionPct}%` }} />
                                      </div>
                                      <span className="text-xs text-zinc-400 w-9 text-right shrink-0">{c.completionPct}%</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {(subject || body) && (targetRouteId || u.suggested) && (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5"><Eye className="w-3.5 h-3.5" /> Lo que recibiría {u.name}</div>
                              <div className="rounded-xl border border-zinc-800 bg-white overflow-hidden">
                                <div className="px-4 py-2.5 border-b border-zinc-200 bg-zinc-50">
                                  <p className="text-sm font-bold text-zinc-900 truncate">{renderUserTemplate(subject, rv)}</p>
                                </div>
                                <div className="p-4 max-h-[320px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: bodyToHtml(renderUserTemplate(body, rv)) + signature }} />
                              </div>
                            </div>
                          )}
                          {rowMsg[u.id] && <p className="text-xs text-rose-400">{rowMsg[u.id]}</p>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-4">
              <button onClick={() => loadUsers(false)} disabled={loadingUsers}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white font-bold text-sm transition-all disabled:opacity-50">
                {loadingUsers ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />} Cargar más ({users.length}/{total})
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
