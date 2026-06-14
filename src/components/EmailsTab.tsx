"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Loader2, Inbox, Send, Search, RefreshCw, PenSquare, X, Reply,
  Trash2, Copy, Check, AlertTriangle, Mail, MailOpen,
} from "lucide-react";
import {
  adminGetEmailConfig, adminListEmails, adminGetEmail, adminSendEmail, adminDeleteEmail,
  type EmailConfig, type EmailRow, type EmailDetail,
} from "@/app/emailActions";

export default function EmailsTab({ token }: { token: string | null }) {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");
  const [search, setSearch] = useState("");
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<EmailDetail | null>(null);
  const [opening, setOpening] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inboundUrl, setInboundUrl] = useState("");

  // Redacción / respuesta
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [inReplyTo, setInReplyTo] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setInboundUrl(`${window.location.origin}/api/emails/inbound`);
  }, []);

  useEffect(() => {
    if (token) adminGetEmailConfig(token).then(setConfig);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const list = await adminListEmails(token, folder, search);
    setEmails(list);
    setLoading(false);
  }, [token, folder, search]);

  useEffect(() => {
    if (token) load();
  }, [token, folder, load]);

  const open = async (id: string) => {
    if (!token) return;
    setOpening(true);
    const detail = await adminGetEmail(token, id);
    setSelected(detail);
    setOpening(false);
    // Refrescar el badge de no leídos y el estado leído de la lista.
    if (detail) {
      setEmails(es => es.map(e => (e.id === id ? { ...e, isRead: true } : e)));
      adminGetEmailConfig(token).then(setConfig);
    }
  };

  const startCompose = () => {
    setTo(""); setSubject(""); setBody(""); setInReplyTo(undefined); setSendErr("");
    setComposing(true);
  };

  const startReply = (e: EmailDetail) => {
    setTo(e.from);
    setSubject(e.subject?.toLowerCase().startsWith("re:") ? e.subject : `Re: ${e.subject || ""}`);
    setBody("");
    setInReplyTo(e.id);
    setSendErr("");
    setSelected(null);
    setComposing(true);
  };

  const send = async () => {
    if (!token) return;
    setSendErr("");
    setSending(true);
    const res = await adminSendEmail(token, { to, subject, body, inReplyTo });
    setSending(false);
    if (!res.ok) { setSendErr(res.error || "No se pudo enviar."); return; }
    setComposing(false);
    if (folder === "sent") load();
  };

  const remove = async (id: string) => {
    if (!token) return;
    setBusyId(id);
    const res = await adminDeleteEmail(token, id);
    setBusyId(null);
    if (res.ok) {
      setEmails(es => es.filter(e => e.id !== id));
      if (selected?.id === id) setSelected(null);
    }
  };

  const copyInbound = async () => {
    try {
      await navigator.clipboard.writeText(inboundUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard bloqueado */ }
  };

  const fmtDate = (s: string) => new Date(s).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      {/* Estado / configuración */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Mail className="w-4 h-4 text-primary" />
          <h2 className="font-bold">Bandeja de correo</h2>
        </div>
        <p className="text-sm text-zinc-500 mb-3">
          Envía con <span className="text-zinc-300">Resend</span> y recibe vía el webhook que llama tu{" "}
          <span className="text-zinc-300">Email Worker de Cloudflare</span>.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config?.resendConfigured ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}>
            {config?.resendConfigured ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {config?.resendConfigured ? `Envío listo (${config.fromAddress})` : "Faltan RESEND_API_KEY / EMAIL_FROM"}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config?.inboundSecretSet ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}>
            {config?.inboundSecretSet ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {config?.inboundSecretSet ? "Recepción lista (secreto puesto)" : "Falta EMAIL_INBOUND_SECRET"}
          </span>
          {config && !config.tableReady && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-500/10 text-amber-300 border-amber-500/40">
              <AlertTriangle className="w-3 h-3" /> Falta tabla — corre scripts/emails-setup.sql
            </span>
          )}
        </div>

        <p className="text-xs text-zinc-500 mb-1.5">URL del webhook de entrada (pégala en tu Email Worker de Cloudflare):</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-300">{inboundUrl || "…"}</code>
          <button onClick={copyInbound} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>

      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="inline-flex bg-zinc-900 border border-zinc-800 rounded-2xl p-1">
          <button
            onClick={() => { setFolder("inbox"); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${folder === "inbox" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"}`}
          >
            <Inbox className="w-4 h-4" /> Recibidos
            {config && config.unread > 0 && (
              <span className="ml-0.5 text-[10px] bg-rose-500 text-white rounded-full px-1.5 py-0.5 leading-none">{config.unread}</span>
            )}
          </button>
          <button
            onClick={() => { setFolder("sent"); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${folder === "sent" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"}`}
          >
            <Send className="w-4 h-4" /> Enviados
          </button>
        </div>

        <form onSubmit={e => { e.preventDefault(); load(); }} className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por asunto o correo..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-2.5 pl-11 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
          />
        </form>

        <button onClick={load} title="Actualizar" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={startCompose} className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all">
          <PenSquare className="w-4 h-4" /> Redactar
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando correos...</div>
      ) : emails.length === 0 ? (
        <p className="text-zinc-500 py-10 text-center">
          {folder === "inbox" ? "No hay correos recibidos todavía." : "No has enviado correos todavía."}
        </p>
      ) : (
        <div className="space-y-2">
          {emails.map(e => {
            const unread = folder === "inbox" && !e.isRead;
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => open(e.id)}
                className={`cursor-pointer bg-zinc-900/80 border rounded-2xl p-4 flex items-center gap-3 transition-colors hover:border-zinc-700 ${unread ? "border-primary/40" : "border-zinc-800"}`}
              >
                <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${unread ? "bg-primary/15 text-primary" : "bg-zinc-800 text-zinc-500"}`}>
                  {folder === "sent" ? <Send className="w-4 h-4" /> : unread ? <Mail className="w-4 h-4" /> : <MailOpen className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`truncate ${unread ? "font-bold text-white" : "font-semibold text-zinc-300"}`}>
                      {folder === "sent" ? `Para: ${e.to}` : e.from}
                    </span>
                    {e.status === "failed" && <span className="text-[10px] uppercase font-bold text-rose-300 bg-rose-500/15 px-1.5 py-0.5 rounded shrink-0">falló</span>}
                  </div>
                  <p className={`text-sm truncate ${unread ? "text-zinc-200" : "text-zinc-400"}`}>{e.subject || "(sin asunto)"}</p>
                  <p className="text-xs text-zinc-600 truncate mt-0.5">{e.snippet || "—"}</p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <span className="text-xs text-zinc-600 whitespace-nowrap">{fmtDate(e.createdAt)}</span>
                  <button
                    onClick={ev => { ev.stopPropagation(); remove(e.id); }}
                    disabled={busyId === e.id}
                    title="Borrar"
                    className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400 flex items-center justify-center transition-all disabled:opacity-40"
                  >
                    {busyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Detalle */}
      {(selected || opening) && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col relative"
          >
            <button onClick={() => setSelected(null)} className="absolute top-4 right-4 text-zinc-500 hover:text-white z-10"><X className="w-5 h-5" /></button>
            {opening || !selected ? (
              <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
            ) : (
              <>
                <div className="p-6 border-b border-zinc-800">
                  <h3 className="text-xl font-bold pr-8 mb-3">{selected.subject || "(sin asunto)"}</h3>
                  <p className="text-sm text-zinc-400"><span className="text-zinc-600">De:</span> {selected.from}</p>
                  <p className="text-sm text-zinc-400"><span className="text-zinc-600">Para:</span> {selected.to}</p>
                  <p className="text-xs text-zinc-600 mt-1">{fmtDate(selected.createdAt)}</p>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-zinc-200 leading-relaxed">
                    {selected.bodyText || (selected.bodyHtml ? selected.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "(sin contenido)")}
                  </pre>
                </div>
                <div className="p-4 border-t border-zinc-800 flex gap-3">
                  <button onClick={() => startReply(selected)} className="flex-1 py-3 rounded-2xl bg-primary text-white font-bold hover:bg-primary-hover transition-all inline-flex items-center justify-center gap-2">
                    <Reply className="w-4 h-4" /> Responder
                  </button>
                  <button onClick={() => remove(selected.id)} className="px-5 py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-bold hover:bg-rose-500/20 hover:text-rose-400 transition-all inline-flex items-center justify-center gap-2">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}

      {/* Redactar / Responder */}
      {composing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !sending && setComposing(false)}>
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl relative"
          >
            <button onClick={() => !sending && setComposing(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            <div className="p-6">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                {inReplyTo ? <Reply className="w-5 h-5 text-primary" /> : <PenSquare className="w-5 h-5 text-primary" />}
                {inReplyTo ? "Responder" : "Nuevo correo"}
              </h3>
              <div className="space-y-3">
                <input
                  type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="Para: destinatario@correo.com"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
                />
                <input
                  type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Asunto"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
                />
                <textarea
                  value={body} onChange={e => setBody(e.target.value)} placeholder="Escribe tu mensaje..." rows={10}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-y"
                />
                {sendErr && <p className="text-rose-400 text-sm">{sendErr}</p>}
                <div className="flex justify-end gap-3 pt-1">
                  <button onClick={() => setComposing(false)} disabled={sending} className="px-5 py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 transition-all disabled:opacity-60">Cancelar</button>
                  <button onClick={send} disabled={sending} className="px-6 py-3 rounded-2xl bg-primary text-white font-bold hover:bg-primary-hover transition-all disabled:opacity-60 inline-flex items-center gap-2">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
