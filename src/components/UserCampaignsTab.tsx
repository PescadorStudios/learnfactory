"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Megaphone, Search, RefreshCw, Check, AlertTriangle, Sparkles, Send,
  ChevronDown, ChevronUp, Eye, Clock, Square, CheckSquare, StopCircle, Trash2,
  X, FilePlus2, Save, BookOpen, User as UserIcon, Mail,
} from "lucide-react";
import {
  ucGetConfig, ucListCampaigns, ucSaveCampaign, ucDeleteCampaign, ucGenerateWithGemini,
  ucListUsers, ucSendOne,
  type UcConfig, type CampaignRow, type UcUserRow, type UcListFilters,
} from "@/app/userCampaignsActions";
import { adminGetSignature } from "@/app/emailActions";
import { renderUserTemplate, type UserMergeVars } from "@/lib/crm/render";

// Mismo throttle que el CRM de creadores: pausa aleatoria entre envíos para
// cuidar la reputación de la dirección.
const THROTTLE_MIN_MS = 12_000;
const THROTTLE_MAX_MS = 35_000;
const randomDelay = () => THROTTLE_MIN_MS + Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS);

// Mismo wrapper que htmlFromText() del servidor, para que el preview coincida.
function bodyToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escaped}</div>`;
}

const MERGE_HINT = "{{nombre}}, {{curso}}, {{progreso}}, {{enlace}}";

export default function UserCampaignsTab({ token }: { token: string | null }) {
  const [config, setConfig] = useState<UcConfig | null>(null);
  const [signature, setSignature] = useState("");

  // Biblioteca de campañas + editor
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorMsg, setEditorMsg] = useState("");
  const [confirmDelCampaign, setConfirmDelCampaign] = useState<string | null>(null);

  // Generación con Gemini
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [showAi, setShowAi] = useState(false);

  // Usuarios
  const [users, setUsers] = useState<UcUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [fSearch, setFSearch] = useState("");
  const [fOnlyInProgress, setFOnlyInProgress] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Selección + envío en lote
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingBatch, setSendingBatch] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchMsg, setBatchMsg] = useState("");
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const stopRef = useRef(false);

  const dirty =
    selectedCampaignId
      ? (() => {
          const c = campaigns.find(x => x.id === selectedCampaignId);
          return !c || c.name !== name || c.subject !== subject || c.body !== body;
        })()
      : Boolean(name || subject || body);

  const campaignUsesCourse = /\{\{\s*(curso|enlace|progreso)\s*\}\}/.test(subject + body);

  const loadConfig = useCallback(async () => {
    if (!token) return;
    const c = await ucGetConfig(token);
    setConfig(c);
  }, [token]);

  const loadCampaigns = useCallback(async () => {
    if (!token) return;
    const list = await ucListCampaigns(token);
    setCampaigns(list);
  }, [token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    setLoadingUsers(true);
    const filters: UcListFilters = {
      search: fSearch,
      onlyInProgress: fOnlyInProgress,
      campaignId: selectedCampaignId || undefined,
    };
    const list = await ucListUsers(token, filters);
    setUsers(list);
    setLoadingUsers(false);
  }, [token, fSearch, fOnlyInProgress, selectedCampaignId]);

  useEffect(() => {
    if (!token) return;
    loadConfig();
    loadCampaigns();
    adminGetSignature(token).then(setSignature);
  }, [token, loadConfig, loadCampaigns]);

  useEffect(() => {
    if (token && config?.tablesReady) loadUsers();
  }, [token, config?.tablesReady, loadUsers]);

  // ── Editor ──
  const newCampaign = () => {
    setSelectedCampaignId(null);
    setName(""); setSubject(""); setBody("");
    setEditorMsg(""); setAiMsg("");
  };

  const selectCampaign = (c: CampaignRow) => {
    setSelectedCampaignId(c.id);
    setName(c.name); setSubject(c.subject); setBody(c.body);
    setEditorMsg(""); setAiMsg("");
    setSelected(new Set());
  };

  const save = async () => {
    if (!token) return;
    setSaving(true); setEditorMsg("");
    const res = await ucSaveCampaign(token, { id: selectedCampaignId || undefined, name, subject, body });
    setSaving(false);
    if (!res.ok) { setEditorMsg(res.error || "No se pudo guardar."); return; }
    setSelectedCampaignId(res.id || selectedCampaignId);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    await loadCampaigns();
  };

  const doDeleteCampaign = async (id: string) => {
    if (!token) return;
    const res = await ucDeleteCampaign(token, id);
    if (res.ok) {
      setConfirmDelCampaign(null);
      if (selectedCampaignId === id) newCampaign();
      await loadCampaigns();
    }
  };

  const generate = async () => {
    if (!token || !aiPrompt.trim()) return;
    setAiBusy(true); setAiMsg("");
    const res = await ucGenerateWithGemini(token, {
      prompt: aiPrompt,
      currentSubject: subject || undefined,
      currentBody: body || undefined,
    });
    setAiBusy(false);
    if (!res.ok) { setAiMsg(res.error || "No se pudo generar."); return; }
    setSubject(res.subject || "");
    setBody(res.body || "");
    setAiMsg("Listo: revisa el correo y ajústalo antes de guardar.");
  };

  // ── Selección + envío ──
  const sendableIds = users
    .filter(u => !campaignUsesCourse || u.suggested)
    .map(u => u.id);

  const toggleSel = (id: string) =>
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = () => setSelected(new Set(sendableIds));
  const clearSel = () => setSelected(new Set());

  const runBatch = async (ids: string[]) => {
    if (!token || !selectedCampaignId || ids.length === 0) return;
    setSendingBatch(true);
    stopRef.current = false;
    setBatchMsg(""); setRowMsg({});
    let sent = 0;
    let finalMsg = "";
    for (let i = 0; i < ids.length; i++) {
      if (stopRef.current) { finalMsg = `Detenido. Enviados ${sent} de ${ids.length}.`; break; }
      setProgress({ current: i + 1, total: ids.length });
      const res = await ucSendOne(token, selectedCampaignId, ids[i]);
      if (res.capReached) { finalMsg = `Tope diario alcanzado. Enviados ${sent}. Sigue mañana.`; break; }
      if (res.ok) sent++;
      else setRowMsg(m => ({ ...m, [ids[i]]: res.error || "Falló el envío." }));
      if (i < ids.length - 1 && !stopRef.current) {
        await new Promise(r => setTimeout(r, randomDelay()));
      }
    }
    setBatchMsg(finalMsg || `Listo. Enviados ${sent} de ${ids.length}.`);
    setSendingBatch(false);
    setProgress(null);
    clearSel();
    loadConfig();
    loadUsers();
  };

  const sendSelected = () => runBatch([...selected].filter(id => sendableIds.includes(id)));

  // ── Preview (usa el contenido del editor + un usuario de muestra) ──
  const sampleUser =
    [...selected].map(id => users.find(u => u.id === id)).find(u => u?.suggested) ||
    users.find(u => u.suggested) ||
    users[0] ||
    null;
  const previewVars: UserMergeVars = {
    nombre: sampleUser?.name || "Juan",
    curso: sampleUser?.suggested?.topic || "Fundamentos de Teología",
    progreso: sampleUser?.suggested ? `${sampleUser.suggested.completionPct}%` : "35%",
    enlace: sampleUser?.suggested?.link || "https://learnfactory…/route/…",
  };
  const previewSubject = renderUserTemplate(subject, previewVars);
  const previewHtml = bodyToHtml(renderUserTemplate(body, previewVars)) + signature;

  if (!config) {
    return <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando campañas…</div>;
  }

  const selectedCount = [...selected].filter(id => sendableIds.includes(id)).length;

  return (
    <>
      {/* Estado / config */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Megaphone className="w-4 h-4 text-primary" />
          <h2 className="font-bold">Campañas a usuarios</h2>
        </div>
        <p className="text-sm text-zinc-500 mb-3">
          Redacta un correo (a mano o con <span className="text-zinc-300">Gemini</span>), guárdalo con un nombre, y
          envíalo en lote a tus usuarios para invitarlos a <span className="text-zinc-300">terminar el curso que empezaron</span>.
          Misma dirección, firma y pausas entre correos del panel. Nada sale sin tu envío.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.resendConfigured ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}>
            {config.resendConfigured ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {config.resendConfigured ? `Envío listo (${config.fromAddress})` : "Faltan RESEND_API_KEY / EMAIL_FROM"}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.geminiReady ? "bg-violet-500/15 text-violet-300 border-violet-500/40" : "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
            <Sparkles className="w-3 h-3" /> {config.geminiReady ? "Gemini conectado" : "Sin GEMINI_API_KEY"}
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

      {/* Biblioteca de campañas guardadas */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={newCampaign}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-bold border transition-all ${!selectedCampaignId ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"}`}
        >
          <FilePlus2 className="w-4 h-4" /> Nueva
        </button>
        {campaigns.map(c => (
          <div key={c.id} className={`inline-flex items-center rounded-2xl border ${selectedCampaignId === c.id ? "bg-primary/15 border-primary/40" : "bg-zinc-900 border-zinc-800"}`}>
            <button
              onClick={() => selectCampaign(c)}
              className={`pl-3 pr-2 py-2 text-sm font-bold ${selectedCampaignId === c.id ? "text-primary" : "text-zinc-400 hover:text-white"}`}
            >
              {c.name}
            </button>
            {confirmDelCampaign === c.id ? (
              <span className="flex items-center pr-1">
                <button onClick={() => doDeleteCampaign(c.id)} title="Confirmar borrado" className="w-7 h-7 rounded-lg text-rose-300 hover:bg-rose-500/20 flex items-center justify-center"><Check className="w-3.5 h-3.5" /></button>
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
        {/* Editor */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-2.5">
          <div>
            <label className="text-xs text-zinc-500">Nombre de la campaña (con esto la guardas)</label>
            <input
              value={name} onChange={e => setName(e.target.value)} placeholder='Ej. "Retomar teología v1"'
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Asunto</label>
            <input
              value={subject} onChange={e => setSubject(e.target.value)} placeholder="{{nombre}}, te quedaste a {{progreso}} de terminar…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Cuerpo (merge fields: {MERGE_HINT})</label>
            <textarea
              value={body} onChange={e => setBody(e.target.value)} rows={10}
              placeholder={`Hola {{nombre}},\n\nVi que empezaste "{{curso}}" y vas en {{progreso}}. ¡Te falta poquito!\n\nRetómalo aquí:\n{{enlace}}`}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-sm text-zinc-200 focus:outline-none focus:border-primary resize-y"
            />
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
                    <textarea
                      value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3}
                      placeholder="Describe el correo que quieres. Ej: 'Tono cálido y motivador, recuérdale que ya invirtió tiempo y que terminar el curso le toma menos de lo que cree. Crea un poco de urgencia amable.'"
                      className="w-full bg-zinc-950 border border-violet-500/30 rounded-xl py-2 px-3 text-sm text-zinc-200 focus:outline-none focus:border-violet-500 resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={generate}
                        disabled={aiBusy || !aiPrompt.trim() || !config.geminiReady}
                        title={config.geminiReady ? "Redactar con Gemini" : "Falta GEMINI_API_KEY"}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500/20 text-violet-200 border border-violet-500/40 font-bold text-sm hover:bg-violet-500/30 transition-all disabled:opacity-50"
                      >
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

          {/* Guardar */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm transition-all disabled:opacity-40 ${saved ? "bg-emerald-500 text-emerald-950" : "bg-primary text-white hover:bg-primary-hover"}`}
            >
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
            <Eye className="w-3.5 h-3.5" /> Preview {sampleUser?.suggested ? `(con ${sampleUser.name})` : "(con datos de ejemplo)"}
          </div>
          <div className="rounded-xl border border-zinc-800 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-200 bg-zinc-50">
              <p className="text-[11px] text-zinc-500">Para: {sampleUser?.email || "usuario@ejemplo.com"}</p>
              <p className="text-sm font-bold text-zinc-900 truncate">{previewSubject || "(asunto vacío)"}</p>
            </div>
            <div className="p-4 max-h-[420px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>

      {/* ── Usuarios ── */}
      <div className="flex items-center gap-2 mb-3">
        <Mail className="w-4 h-4 text-primary" />
        <h3 className="font-bold">Usuarios registrados</h3>
        {!selectedCampaignId && <span className="text-xs text-amber-400/80">— guarda o selecciona una campaña para poder enviar</span>}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => setFOnlyInProgress(v => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-sm font-bold border transition-all ${fOnlyInProgress ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"}`}
        >
          <BookOpen className="w-4 h-4" /> Solo con curso a medias
        </button>
        <form onSubmit={e => { e.preventDefault(); loadUsers(); }} className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="Buscar por correo o usuario…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-2.5 pl-11 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
          />
        </form>
        <button onClick={loadUsers} title="Actualizar" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Barra de acciones de lote */}
      {sendableIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3">
          <button onClick={selectAll} className="text-xs text-zinc-400 hover:text-white font-bold">Seleccionar todos ({sendableIds.length})</button>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-zinc-500">· {selectedCount} seleccionados</span>
              <button onClick={clearSel} className="text-xs text-zinc-500 hover:text-white">limpiar</button>
            </>
          )}
          <button
            onClick={sendSelected}
            disabled={sendingBatch || !selectedCampaignId || selectedCount === 0}
            title={!selectedCampaignId ? "Guarda o selecciona una campaña primero" : "Enviar a los seleccionados"}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all disabled:opacity-50"
          >
            {sendingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar lote ({selectedCount})
          </button>
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

      {/* Lista */}
      {loadingUsers ? (
        <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando usuarios…</div>
      ) : users.length === 0 ? (
        <p className="text-zinc-500 py-10 text-center">
          {fOnlyInProgress ? "Ningún usuario tiene un curso a medias con estos filtros." : "No se encontraron usuarios."}
        </p>
      ) : (
        <div className="space-y-2">
          {users.map(u => {
            const isOpen = expanded === u.id;
            const selectable = !campaignUsesCourse || Boolean(u.suggested);
            return (
              <div key={u.id} className={`bg-zinc-900/80 border rounded-2xl overflow-hidden ${selected.has(u.id) ? "border-primary/40" : "border-zinc-800"}`}>
                <div className="p-4 flex items-center gap-3">
                  {selectable ? (
                    <button onClick={() => toggleSel(u.id)} className="shrink-0 text-primary">
                      {selected.has(u.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-zinc-600" />}
                    </button>
                  ) : (
                    <span className="shrink-0 w-5" />
                  )}
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0">
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-5 h-5 text-zinc-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(isOpen ? null : u.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white truncate">{u.name}</span>
                      {u.alreadySent && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border bg-sky-500/15 text-sky-300 border-sky-500/40">ya enviado</span>}
                      {!u.suggested && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border bg-zinc-700/40 text-zinc-400 border-zinc-600">sin curso a medias</span>}
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {u.email}
                      {u.suggested && <> · <span className="text-zinc-400">{u.suggested.topic}</span> · {u.suggested.completionPct}%</>}
                    </p>
                  </div>
                  <button onClick={() => setExpanded(isOpen ? null : u.id)} className="shrink-0 text-zinc-500 hover:text-white">
                    {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-zinc-800">
                      <div className="p-4 space-y-3">
                        {/* Cursos a medias */}
                        <div>
                          <p className="text-xs text-zinc-500 mb-1.5">Cursos empezados sin terminar ({u.inProgress.length})</p>
                          {u.inProgress.length === 0 ? (
                            <p className="text-xs text-zinc-600">No tiene cursos a medias.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {u.inProgress.map((c, idx) => (
                                <div key={c.routeId} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${idx === 0 ? "border-primary/40 bg-primary/5" : "border-zinc-800 bg-zinc-950/40"}`}>
                                  <BookOpen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                  <span className="text-sm text-zinc-200 truncate flex-1">{c.topic}</span>
                                  {idx === 0 && <span className="text-[10px] uppercase font-bold text-primary">se usará</span>}
                                  <div className="w-24 h-1.5 rounded-full bg-zinc-800 overflow-hidden shrink-0">
                                    <div className="h-full bg-primary" style={{ width: `${c.completionPct}%` }} />
                                  </div>
                                  <span className="text-xs text-zinc-400 w-9 text-right shrink-0">{c.completionPct}%</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Preview del correo que recibiría ESTE usuario */}
                        {u.suggested && (subject || body) && (
                          <div>
                            <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5"><Eye className="w-3.5 h-3.5" /> Lo que recibiría {u.name}</div>
                            <div className="rounded-xl border border-zinc-800 bg-white overflow-hidden">
                              <div className="px-4 py-2.5 border-b border-zinc-200 bg-zinc-50">
                                <p className="text-sm font-bold text-zinc-900 truncate">
                                  {renderUserTemplate(subject, { nombre: u.name, curso: u.suggested.topic, progreso: `${u.suggested.completionPct}%`, enlace: u.suggested.link })}
                                </p>
                              </div>
                              <div
                                className="p-4 max-h-[320px] overflow-y-auto"
                                dangerouslySetInnerHTML={{
                                  __html: bodyToHtml(renderUserTemplate(body, { nombre: u.name, curso: u.suggested.topic, progreso: `${u.suggested.completionPct}%`, enlace: u.suggested.link })) + signature,
                                }}
                              />
                            </div>
                          </div>
                        )}
                        {rowMsg[u.id] && <p className="text-xs text-rose-400">{rowMsg[u.id]}</p>}
                        {u.suggested && <p className="text-[11px] text-zinc-600 truncate">Enlace para retomar: {u.suggested.link}</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
