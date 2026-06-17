"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Users, Search, RefreshCw, Check, AlertTriangle, ClipboardPaste,
  MonitorPlay, AtSign, Hash, Send, ChevronDown, ChevronUp, Eye, Clock, Square, CheckSquare,
  StopCircle, PenSquare,
} from "lucide-react";
import {
  crmGetConfig, crmImportBatch, crmListCreators, crmUpdateCreator, crmApproveCreator,
  crmSendOne, crmSendFollowup, crmSetFollowupTemplate,
  type CrmConfig, type CreatorRow, type ListFilters, type CreatorPatch,
} from "@/app/creatorsActions";
import { adminGetSignature } from "@/app/emailActions";
import { renderTemplate, isValidEmail, type MergeVars } from "@/lib/crm/render";

// Throttle del envío en lote (orquestado desde el panel). Intervalo aleatorio
// entre envíos para cuidar la reputación de la dirección. Ajustable aquí.
const THROTTLE_MIN_MS = 12_000;
const THROTTLE_MAX_MS = 35_000;
const randomDelay = () => THROTTLE_MIN_MS + Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS);

const STATUS_LABELS: Record<string, string> = {
  investigado: "Investigado",
  construyendo_ruta: "Construyendo ruta",
  listo: "Listo",
  enviado: "Enviado",
  seguimiento_enviado: "Seguimiento enviado",
  respondio: "Respondió",
  interesado: "Interesado",
  ganado: "Ganado",
  rechazado: "Rechazado",
  reboto: "Rebotó",
  solo_manual: "Solo manual",
};
const STATUS_ORDER = Object.keys(STATUS_LABELS);

function statusColor(s: string): string {
  switch (s) {
    case "listo": return "bg-primary/15 text-primary border-primary/40";
    case "enviado": case "seguimiento_enviado": return "bg-sky-500/15 text-sky-300 border-sky-500/40";
    case "respondio": case "interesado": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "ganado": return "bg-amber-500/15 text-amber-300 border-amber-500/40";
    case "rechazado": case "reboto": return "bg-rose-500/15 text-rose-300 border-rose-500/40";
    case "solo_manual": return "bg-zinc-700/40 text-zinc-300 border-zinc-600";
    default: return "bg-zinc-800 text-zinc-400 border-zinc-700";
  }
}

// Mismo wrapper que htmlFromText() del servidor, para que el preview coincida.
function bodyToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escaped}</div>`;
}

export default function CreatorsTab({ token }: { token: string | null }) {
  const [config, setConfig] = useState<CrmConfig | null>(null);
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [signature, setSignature] = useState("");

  // Importación
  const [showImport, setShowImport] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Filtros
  const [fStatus, setFStatus] = useState("");
  const [fHasEmail, setFHasEmail] = useState<"" | "yes" | "no">("");
  const [fSearch, setFSearch] = useState("");
  const [fFollowup, setFFollowup] = useState(false);

  // Revisión por fila
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CreatorPatch>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});

  // Selección + envío en lote
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingBatch, setSendingBatch] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchMsg, setBatchMsg] = useState("");
  const stopRef = useRef(false);

  // Plantilla de seguimiento
  const [showFollowupTpl, setShowFollowupTpl] = useState(false);
  const [followupTpl, setFollowupTpl] = useState("");
  const [tplStatus, setTplStatus] = useState<"idle" | "saving" | "saved">("idle");

  const loadConfig = useCallback(async () => {
    if (!token) return;
    const c = await crmGetConfig(token);
    setConfig(c);
    if (c) setFollowupTpl(c.followupTemplate);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const filters: ListFilters = {
      status: fStatus,
      hasEmail: fHasEmail,
      search: fSearch,
      followupDue: fFollowup,
    };
    const list = await crmListCreators(token, filters);
    setCreators(list);
    setLoading(false);
  }, [token, fStatus, fHasEmail, fSearch, fFollowup]);

  useEffect(() => {
    if (!token) return;
    loadConfig();
    adminGetSignature(token).then(setSignature);
  }, [token, loadConfig]);

  useEffect(() => { if (token && config?.tablesReady) load(); }, [token, config?.tablesReady, load]);

  // ── Importación ──
  const doImport = async () => {
    if (!token || !jsonText.trim()) return;
    setImporting(true);
    setImportMsg(null);
    const res = await crmImportBatch(token, jsonText);
    setImporting(false);
    if (!res.ok) { setImportMsg({ ok: false, text: res.error || "No se pudo importar." }); return; }
    setImportMsg({ ok: true, text: `Importado: ${res.inserted} nuevos, ${res.updated} actualizados.` });
    setJsonText("");
    loadConfig();
    load();
  };

  // ── Edición por fila ──
  const draftFor = (c: CreatorRow): CreatorPatch => drafts[c.id] ?? {};
  const fieldVal = (c: CreatorRow, k: keyof CreatorPatch): string => {
    const d = draftFor(c);
    if (d[k] !== undefined) return d[k] as string;
    switch (k) {
      case "emailSubject": return c.emailSubject;
      case "emailBody": return c.emailBody;
      case "personalizedNote": return c.personalizedNote;
      case "routeLink": return c.routeLink;
      case "email": return c.email || "";
      default: return "";
    }
  };
  const setField = (id: string, k: keyof CreatorPatch, v: string) =>
    setDrafts(d => ({ ...d, [id]: { ...d[id], [k]: v } }));

  const saveRow = async (c: CreatorRow) => {
    if (!token) return;
    const patch = draftFor(c);
    if (Object.keys(patch).length === 0) return;
    setSavingId(c.id);
    const res = await crmUpdateCreator(token, c.id, patch);
    setSavingId(null);
    if (res.ok) {
      setCreators(cs => cs.map(x => x.id === c.id ? { ...x, ...patchToRow(patch) } : x));
      setDrafts(d => { const n = { ...d }; delete n[c.id]; return n; });
      setRowMsg(m => ({ ...m, [c.id]: "" }));
      // Cambiar el correo puede mover el estado (solo_manual → investigado) y
      // los conteros: recargamos para reflejarlo.
      if (patch.email !== undefined) { loadConfig(); load(); }
    } else {
      setRowMsg(m => ({ ...m, [c.id]: res.error || "No se pudo guardar." }));
    }
  };

  const approve = async (c: CreatorRow) => {
    if (!token) return;
    // Primero persistimos cualquier edición pendiente, luego aprobamos.
    await saveRow(c);
    setSavingId(c.id);
    const res = await crmApproveCreator(token, c.id);
    setSavingId(null);
    if (res.ok) {
      setCreators(cs => cs.map(x => x.id === c.id ? { ...x, status: "listo" } : x));
      setRowMsg(m => ({ ...m, [c.id]: "" }));
    } else {
      setRowMsg(m => ({ ...m, [c.id]: res.error || "No se pudo aprobar." }));
    }
  };

  const changeStatus = async (c: CreatorRow, status: string) => {
    if (!token) return;
    const res = await crmUpdateCreator(token, c.id, { status: status as CreatorPatch["status"] });
    if (res.ok) setCreators(cs => cs.map(x => x.id === c.id ? { ...x, status: status as CreatorRow["status"] } : x));
  };

  // ── Selección ──
  const toggleSel = (id: string) =>
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const listoIds = creators.filter(c => c.status === "listo").map(c => c.id);
  const selectAllListo = () => setSelected(new Set(listoIds));
  const clearSel = () => setSelected(new Set());

  // ── Envío en lote (orquestado, con throttle) ──
  const runBatch = async (ids: string[], kind: "initial" | "followup") => {
    if (!token || ids.length === 0) return;
    setSendingBatch(true);
    stopRef.current = false;
    setBatchMsg("");
    let sent = 0;
    let finalMsg = "";
    for (let i = 0; i < ids.length; i++) {
      if (stopRef.current) { finalMsg = `Detenido. Enviados ${sent} de ${ids.length}.`; break; }
      setProgress({ current: i + 1, total: ids.length });
      const res = kind === "initial"
        ? await crmSendOne(token, ids[i])
        : await crmSendFollowup(token, ids[i]);
      if (res.capReached) { finalMsg = `Tope diario alcanzado. Enviados ${sent}. Sigue mañana.`; break; }
      if (res.ok) sent++;
      else setRowMsg(m => ({ ...m, [ids[i]]: res.error || "Falló el envío." }));
      // Pausa aleatoria antes del siguiente (no tras el último).
      if (i < ids.length - 1 && !stopRef.current) {
        await new Promise(r => setTimeout(r, randomDelay()));
      }
    }
    setBatchMsg(finalMsg || `Listo. Enviados ${sent} de ${ids.length}.`);
    setSendingBatch(false);
    setProgress(null);
    clearSel();
    loadConfig();
    load();
  };

  const sendSelected = () => runBatch([...selected].filter(id => listoIds.includes(id)), "initial");
  const followupIds = creators.filter(c => c.followupDue).map(c => c.id);

  const saveFollowupTpl = async () => {
    if (!token) return;
    setTplStatus("saving");
    const res = await crmSetFollowupTemplate(token, followupTpl);
    setTplStatus(res.ok ? "saved" : "idle");
    if (res.ok) setTimeout(() => setTplStatus(s => s === "saved" ? "idle" : s), 1500);
  };

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";

  // ── Render ──
  if (!config) {
    return <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando CRM...</div>;
  }

  return (
    <>
      {/* Estado / config */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="font-bold">CRM de creadores</h2>
        </div>
        <p className="text-sm text-zinc-500 mb-3">
          Importa el JSON del skill, revisa y personaliza fila por fila, y envía en lote con{" "}
          <span className="text-zinc-300">Resend</span> (misma dirección y firma del panel). Nada sale sin tu aprobación.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.resendConfigured ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}>
            {config.resendConfigured ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {config.resendConfigured ? `Envío listo (${config.fromAddress})` : "Faltan RESEND_API_KEY / EMAIL_FROM"}
          </span>
          {!config.tablesReady && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-500/10 text-amber-300 border-amber-500/40">
              <AlertTriangle className="w-3 h-3" /> Faltan tablas — corre scripts/creators-crm-setup.sql
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-zinc-800 text-zinc-400 border-zinc-700">
            <Clock className="w-3 h-3" /> Hoy: {config.sentToday}/{config.dailyCap} enviados
          </span>
        </div>
      </div>

      {/* Importar */}
      <div className="mb-5">
        <button
          onClick={() => setShowImport(v => !v)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white font-bold text-sm transition-colors"
        >
          <ClipboardPaste className="w-4 h-4" /> Importar JSON {showImport ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <AnimatePresence>
          {showImport && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 mt-3">
                <p className="text-xs text-zinc-500 mb-2">Pega aquí el JSON del skill de investigación. Reimportar el mismo lote no duplica: refresca datos y conserva tus ediciones y estados.</p>
                <textarea
                  value={jsonText}
                  onChange={e => setJsonText(e.target.value)}
                  placeholder='{ "batch": {...}, "creators": [...] }'
                  rows={8}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-3 px-4 text-zinc-200 text-xs font-mono focus:outline-none focus:border-primary resize-y"
                />
                {importMsg && (
                  <p className={`text-sm mt-2 ${importMsg.ok ? "text-emerald-400" : "text-rose-400"}`}>{importMsg.text}</p>
                )}
                <div className="flex justify-end mt-3">
                  <button
                    onClick={doImport}
                    disabled={importing || !jsonText.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all disabled:opacity-50"
                  >
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />} Importar
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={fStatus} onChange={e => setFStatus(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl py-2.5 px-3 text-sm text-zinc-300 focus:outline-none focus:border-primary"
        >
          <option value="">Todos los estados</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]} {config.counts[s] ? `(${config.counts[s]})` : ""}</option>)}
        </select>
        <select
          value={fHasEmail} onChange={e => setFHasEmail(e.target.value as "" | "yes" | "no")}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl py-2.5 px-3 text-sm text-zinc-300 focus:outline-none focus:border-primary"
        >
          <option value="">Con o sin email</option>
          <option value="yes">Con email</option>
          <option value="no">Sin email</option>
        </select>
        <button
          onClick={() => setFFollowup(v => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-sm font-bold border transition-all ${fFollowup ? "bg-amber-500/15 text-amber-300 border-amber-500/40" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"}`}
        >
          <Clock className="w-4 h-4" /> Toca seguimiento
        </button>
        <form onSubmit={e => { e.preventDefault(); load(); }} className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="Buscar por nombre..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-2.5 pl-11 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
          />
        </form>
        <button onClick={() => { load(); loadConfig(); }} title="Actualizar" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Barra de acciones de lote */}
      {(selected.size > 0 || followupIds.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3">
          {listoIds.length > 0 && (
            <button onClick={selectAllListo} className="text-xs text-zinc-400 hover:text-white font-bold">Seleccionar listas ({listoIds.length})</button>
          )}
          {selected.size > 0 && (
            <>
              <span className="text-xs text-zinc-500">· {selected.size} seleccionadas</span>
              <button onClick={clearSel} className="text-xs text-zinc-500 hover:text-white">limpiar</button>
              <button
                onClick={sendSelected}
                disabled={sendingBatch}
                className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all disabled:opacity-50"
              >
                {sendingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar lote ({[...selected].filter(id => listoIds.includes(id)).length})
              </button>
            </>
          )}
          {selected.size === 0 && followupIds.length > 0 && (
            <button
              onClick={() => runBatch(followupIds, "followup")}
              disabled={sendingBatch}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 text-amber-200 border border-amber-500/40 font-bold text-sm hover:bg-amber-500/30 transition-all disabled:opacity-50"
            >
              {sendingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Enviar seguimiento ({followupIds.length})
            </button>
          )}
        </div>
      )}

      {/* Progreso del envío */}
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

      {/* Lista de creadores */}
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando creadores...</div>
      ) : creators.length === 0 ? (
        <p className="text-zinc-500 py-10 text-center">No hay creadores con estos filtros. Importa un lote para empezar.</p>
      ) : (
        <div className="space-y-2">
          {creators.map(c => {
            const isOpen = expanded === c.id;
            const subject = fieldVal(c, "emailSubject");
            const body = fieldVal(c, "emailBody");
            const note = fieldVal(c, "personalizedNote");
            const link = fieldVal(c, "routeLink");
            const email = fieldVal(c, "email");
            const vars: MergeVars = { name: c.name, tema: c.tema || "", personalized_note: note, route_link: link };
            const previewSubject = renderTemplate(subject, vars);
            const previewHtml = bodyToHtml(renderTemplate(body, vars)) + signature;
            // Advertencia: la plantilla usa {{tema}} (o el alias {{best_series}}) pero la fila no tiene tema.
            const usesTema = /\{\{\s*(tema|best_series)\s*\}\}/.test(subject + body);
            const temaMissing = usesTema && !(c.tema || "").trim();
            const canApprove = isValidEmail(email) && note.trim() && link.trim() && subject.trim() && body.trim();
            const dirty = drafts[c.id] && Object.keys(drafts[c.id]).length > 0;

            return (
              <div key={c.id} className={`bg-zinc-900/80 border rounded-2xl overflow-hidden ${c.status === "listo" ? "border-primary/40" : c.followupDue ? "border-amber-500/40" : "border-zinc-800"}`}>
                {/* Cabecera de fila */}
                <div className="p-4 flex items-center gap-3">
                  {c.status === "listo" && (
                    <button onClick={() => toggleSel(c.id)} className="shrink-0 text-primary">
                      {selected.has(c.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-zinc-600" />}
                    </button>
                  )}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(isOpen ? null : c.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white truncate">{c.name}</span>
                      <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${statusColor(c.status)}`}>{STATUS_LABELS[c.status]}</span>
                      {c.followupDue && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-300 border-amber-500/40">seguimiento</span>}
                      {!isValidEmail(c.email) && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border bg-zinc-700/40 text-zinc-400 border-zinc-600">sin email</span>}
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {c.email || "sin correo"} · {c.subscribersEstimate || "—"} subs · {c.bestSeries || "—"}
                    </p>
                  </div>
                  {/* Links a perfiles */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    {c.youtubeUrl && <a href={c.youtubeUrl} target="_blank" rel="noopener noreferrer" title="YouTube" className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 flex items-center justify-center transition-all"><MonitorPlay className="w-4 h-4" /></a>}
                    {c.instagramUrl && <a href={c.instagramUrl} target="_blank" rel="noopener noreferrer" title="Instagram" className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-pink-500/20 text-zinc-400 hover:text-pink-400 flex items-center justify-center transition-all"><AtSign className="w-4 h-4" /></a>}
                    {c.xUrl && <a href={c.xUrl} target="_blank" rel="noopener noreferrer" title="X" className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-all"><Hash className="w-4 h-4" /></a>}
                  </div>
                  <button onClick={() => setExpanded(isOpen ? null : c.id)} className="shrink-0 text-zinc-500 hover:text-white">
                    {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>

                {/* Editor + preview en vivo */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-zinc-800">
                      <div className="p-4 grid md:grid-cols-2 gap-4">
                        {/* Edición */}
                        <div className="space-y-2.5">
                          {c.personalizationHook && (
                            <p className="text-xs text-zinc-500 bg-zinc-950/60 border border-zinc-800 rounded-xl p-2.5">
                              <span className="text-zinc-400 font-bold">Gancho:</span> {c.personalizationHook}
                            </p>
                          )}
                          <div>
                            <label className="text-xs text-zinc-500">
                              Correo {isValidEmail(email) ? <span className="text-emerald-400">· válido</span> : email.trim() ? <span className="text-rose-400">· formato inválido</span> : <span className="text-amber-400">· falta (escríbelo a mano)</span>}
                            </label>
                            <input
                              type="email" value={email} onChange={e => setField(c.id, "email", e.target.value)} onBlur={() => saveRow(c)} placeholder="correo@dominio.com"
                              className={`w-full bg-zinc-950 border rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary ${email.trim() && !isValidEmail(email) ? "border-rose-500/50" : isValidEmail(email) ? "border-zinc-800" : "border-amber-500/40"}`}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500">Asunto</label>
                            <input
                              value={subject} onChange={e => setField(c.id, "emailSubject", e.target.value)} onBlur={() => saveRow(c)}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500">Cuerpo (usa {"{{name}}"}, {"{{best_series}}"}, {"{{personalized_note}}"}, {"{{route_link}}"})</label>
                            <textarea
                              value={body} onChange={e => setField(c.id, "emailBody", e.target.value)} onBlur={() => saveRow(c)} rows={9}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-zinc-200 focus:outline-none focus:border-primary resize-y"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500">Nota personalizada (obligatoria)</label>
                            <textarea
                              value={note} onChange={e => setField(c.id, "personalizedNote", e.target.value)} onBlur={() => saveRow(c)} rows={2}
                              className={`w-full bg-zinc-950 border rounded-xl py-2 px-3 text-sm text-zinc-200 focus:outline-none focus:border-primary resize-y ${note.trim() ? "border-zinc-800" : "border-amber-500/40"}`}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500">Enlace de la ruta (obligatorio)</label>
                            <input
                              value={link} onChange={e => setField(c.id, "routeLink", e.target.value)} onBlur={() => saveRow(c)} placeholder="https://learnfactory.../route/..."
                              className={`w-full bg-zinc-950 border rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary ${link.trim() ? "border-zinc-800" : "border-amber-500/40"}`}
                            />
                          </div>

                          <div className="flex items-center gap-2 flex-wrap pt-1">
                            <button
                              onClick={() => approve(c)}
                              disabled={savingId === c.id || !canApprove}
                              title={canApprove ? "Aprobar (pasa a 'listo')" : "Faltan email válido, nota o enlace"}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all disabled:opacity-40"
                            >
                              {savingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Aprobar
                            </button>
                            {dirty && <span className="text-xs text-zinc-500">cambios sin guardar se guardan al salir del campo</span>}
                            <select
                              value={c.status} onChange={e => changeStatus(c, e.target.value)}
                              className="ml-auto bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-2 text-xs text-zinc-300 focus:outline-none focus:border-primary"
                            >
                              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                            </select>
                          </div>
                          {rowMsg[c.id] && <p className="text-xs text-rose-400">{rowMsg[c.id]}</p>}
                          {c.replySnippet && (
                            <p className="text-xs text-emerald-400/90 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-2.5">
                              <span className="font-bold">Respondió ({fmtDate(c.replyReceivedAt)}):</span> {c.replySnippet}
                            </p>
                          )}
                          {c.sentAt && <p className="text-[11px] text-zinc-600">Enviado: {fmtDate(c.sentAt)}{c.followUpSentAt ? ` · Seguimiento: ${fmtDate(c.followUpSentAt)}` : ""}</p>}
                        </div>

                        {/* Preview en vivo */}
                        <div>
                          <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5"><Eye className="w-3.5 h-3.5" /> Preview del correo final</div>
                          {temaMissing && (
                            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded-xl p-2.5 mb-1.5 flex items-start gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              La plantilla usa <code className="font-mono">{"{{tema}}"}</code> pero esta fila no tiene tema: saldría vacío. Agrega el tema (reimporta el JSON) o quita el merge field.
                            </p>
                          )}
                          <div className="rounded-xl border border-zinc-800 bg-white overflow-hidden">
                            <div className="px-4 py-2.5 border-b border-zinc-200 bg-zinc-50">
                              <p className="text-[11px] text-zinc-500">Para: {c.email || "(sin email)"}</p>
                              <p className="text-sm font-bold text-zinc-900 truncate">{previewSubject || "(asunto vacío)"}</p>
                            </div>
                            <div className="p-4 max-h-[420px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* Plantilla de seguimiento */}
      <div className="mt-6">
        <button onClick={() => setShowFollowupTpl(v => !v)} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-primary transition-colors">
          <PenSquare className="w-3.5 h-3.5" /> Plantilla de seguimiento {showFollowupTpl ? "▲" : "▼"}
          {tplStatus === "saving" && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
          {tplStatus === "saved" && <Check className="w-3 h-3 text-emerald-400 ml-1" />}
        </button>
        {showFollowupTpl && (
          <div className="mt-2 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 mb-2">Se envía como un único toque a las filas en &quot;enviado&quot; sin respuesta tras {config.followupDays} días. Acepta los mismos merge fields.</p>
            <textarea
              value={followupTpl} onChange={e => setFollowupTpl(e.target.value)} onBlur={saveFollowupTpl} rows={5}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-zinc-200 focus:outline-none focus:border-primary resize-y"
            />
          </div>
        )}
      </div>
    </>
  );
}

// Aplica un patch (claves camelCase de UI) sobre el shape de CreatorRow.
function patchToRow(p: CreatorPatch): Partial<CreatorRow> {
  const r: Partial<CreatorRow> = {};
  if (p.emailSubject !== undefined) r.emailSubject = p.emailSubject;
  if (p.emailBody !== undefined) r.emailBody = p.emailBody;
  if (p.personalizedNote !== undefined) r.personalizedNote = p.personalizedNote;
  if (p.routeLink !== undefined) r.routeLink = p.routeLink;
  if (p.email !== undefined) {
    const e = p.email.trim();
    r.email = e || null;
    r.emailStatus = e ? "found" : "not_found";
  }
  if (p.status !== undefined) r.status = p.status;
  return r;
}
