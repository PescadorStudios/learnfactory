"use server";

// Server actions de Correos. Solo para perfiles role='admin'.
// Enviar (vía Resend) y leer/responder lo recibido (vía webhook de Cloudflare).

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { sendEmail, htmlFromText } from "@/lib/email/resend";

async function requireAdmin(token: string): Promise<{ id: string } | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const { data } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (data?.role !== "admin") return null;
  return { id: user.id };
}

/** Quita etiquetas HTML para un fallback de texto legible. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippetOf(text: string | null, html: string | null): string {
  const base = (text && text.trim()) || (html ? stripHtml(html) : "");
  return base.slice(0, 140);
}

// ── Configuración / estado ──────────────────────────────────────────────────

export interface EmailConfig {
  resendConfigured: boolean; // RESEND_API_KEY + EMAIL_FROM presentes
  fromAddress: string | null;
  inboundSecretSet: boolean; // EMAIL_INBOUND_SECRET presente (para Cloudflare)
  tableReady: boolean; // existe public.emails (corre scripts/emails-setup.sql)
  unread: number;
}

export async function adminGetEmailConfig(token: string): Promise<EmailConfig | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

  let tableReady = true;
  let unread = 0;
  const { count, error } = await sb
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .eq("is_read", false);
  if (error) tableReady = false;
  else unread = count ?? 0;

  return {
    resendConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    fromAddress: process.env.EMAIL_FROM || null,
    inboundSecretSet: Boolean(process.env.EMAIL_INBOUND_SECRET),
    tableReady,
    unread,
  };
}

// ── Listado ─────────────────────────────────────────────────────────────────

export interface EmailRow {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  subject: string | null;
  snippet: string;
  status: string;
  isRead: boolean;
  createdAt: string;
}

export async function adminListEmails(
  token: string,
  folder: "inbox" | "sent" = "inbox",
  search = ""
): Promise<EmailRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  let q = sb
    .from("emails")
    .select("id, direction, from_addr, to_addr, subject, body_text, body_html, status, is_read, created_at")
    .eq("direction", folder === "sent" ? "outbound" : "inbound")
    .order("created_at", { ascending: false })
    .limit(100);

  const term = search.trim();
  if (term) {
    const like = `%${term}%`;
    q = q.or(`subject.ilike.${like},from_addr.ilike.${like},to_addr.ilike.${like}`);
  }

  const { data, error } = await q;
  if (error) return [];
  return (data || []).map(r => ({
    id: r.id,
    direction: r.direction,
    from: r.from_addr,
    to: r.to_addr,
    subject: r.subject ?? null,
    snippet: snippetOf(r.body_text, r.body_html),
    status: r.status,
    isRead: Boolean(r.is_read),
    createdAt: r.created_at,
  }));
}

// ── Detalle (marca leído) ─────────────────────────────────────────────────────

export interface EmailDetail extends EmailRow {
  bodyText: string | null;
  bodyHtml: string | null;
  inReplyTo: string | null;
}

export async function adminGetEmail(token: string, id: string): Promise<EmailDetail | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("emails")
    .select("id, direction, from_addr, to_addr, subject, body_text, body_html, status, is_read, in_reply_to, created_at")
    .eq("id", id)
    .single();
  if (error || !data) return null;

  // Marcar como leído los entrantes al abrirlos.
  if (data.direction === "inbound" && !data.is_read) {
    await sb.from("emails").update({ is_read: true }).eq("id", id);
  }

  return {
    id: data.id,
    direction: data.direction,
    from: data.from_addr,
    to: data.to_addr,
    subject: data.subject ?? null,
    snippet: snippetOf(data.body_text, data.body_html),
    status: data.status,
    isRead: true,
    createdAt: data.created_at,
    bodyText: data.body_text ?? null,
    bodyHtml: data.body_html ?? null,
    inReplyTo: data.in_reply_to ?? null,
  };
}

// ── Enviar (Resend) ───────────────────────────────────────────────────────────

export async function adminSendEmail(
  token: string,
  input: { to: string; subject: string; body: string; inReplyTo?: string }
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };

  const to = input.to.trim();
  const subject = input.subject.trim();
  const body = input.body;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: "Correo de destino no válido." };
  if (!subject) return { ok: false, error: "El asunto no puede estar vacío." };
  if (!body.trim()) return { ok: false, error: "El mensaje no puede estar vacío." };

  const html = htmlFromText(body);
  const result = await sendEmail({ to, subject, text: body, html });

  // Guardamos el saliente pase lo que pase (sent o failed) para tener historial.
  const sb = supabaseAdmin();
  await sb.from("emails").insert({
    direction: "outbound",
    from_addr: process.env.EMAIL_FROM || "no-reply",
    to_addr: to,
    subject,
    body_text: body,
    body_html: html,
    status: result.ok ? "sent" : "failed",
    provider_id: result.id ?? null,
    in_reply_to: input.inReplyTo ?? null,
    raw: result.ok ? { id: result.id } : { error: result.error },
  });

  if (!result.ok) return { ok: false, error: result.error || "No se pudo enviar el correo." };
  return { ok: true };
}

// ── Marcar leído / borrar ─────────────────────────────────────────────────────

export async function adminMarkEmailRead(token: string, id: string, read: boolean): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb.from("emails").update({ is_read: read }).eq("id", id);
  return { ok: !error };
}

export async function adminDeleteEmail(token: string, id: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb.from("emails").delete().eq("id", id);
  return { ok: !error };
}
