"use server";

// Server actions del CRM de creadores. Solo para perfiles role='admin'.
// Importa por pegado (sin API), revisa/edita en lote, envía con throttling
// (orquestado desde el panel) usando Resend + la firma ya configurada, y deja
// que el webhook de correo entrante actualice estados al recibir respuestas.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { sendEmail, htmlFromText } from "@/lib/email/resend";
import { DEFAULT_SIGNATURE } from "@/lib/email/signature";
import { renderTemplate, isValidEmail, DEFAULT_FOLLOWUP_TEMPLATE, type MergeVars } from "@/lib/crm/render";

async function requireAdmin(token: string): Promise<{ id: string } | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const { data } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (data?.role !== "admin") return null;
  return { id: user.id };
}

// Default del tope diario de envíos y de los días para marcar seguimiento.
const DEFAULT_DAILY_CAP = 25;
const DEFAULT_FOLLOWUP_DAYS = 5;
const SIG_KEY = "email_signature";
const FOLLOWUP_TPL_KEY = "crm_followup_template";

const STATUSES = [
  "investigado", "construyendo_ruta", "listo", "enviado", "seguimiento_enviado",
  "respondio", "interesado", "ganado", "rechazado", "reboto", "solo_manual",
] as const;
type CreatorStatus = (typeof STATUSES)[number];

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getSignature(): Promise<string> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("app_settings").select("value").eq("key", SIG_KEY).maybeSingle();
  return (data?.value ?? "").trim() || DEFAULT_SIGNATURE;
}

async function getFollowupTemplate(): Promise<string> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("app_settings").select("value").eq("key", FOLLOWUP_TPL_KEY).maybeSingle();
  return (data?.value ?? "").trim() || DEFAULT_FOLLOWUP_TEMPLATE;
}

// ── Tipos expuestos al cliente ────────────────────────────────────────────────

export interface CrmConfig {
  resendConfigured: boolean;
  fromAddress: string | null;
  tablesReady: boolean;
  dailyCap: number;
  sentToday: number;
  followupDays: number;
  followupTemplate: string;
  counts: Record<string, number>; // status → cantidad
}

export interface CreatorRow {
  id: string;
  name: string;
  niche: string | null;
  language: string | null;
  youtubeUrl: string | null;
  youtubeHandle: string | null;
  subscribersEstimate: string | null;
  instagramHandle: string | null;
  instagramUrl: string | null;
  xHandle: string | null;
  xUrl: string | null;
  email: string | null;
  emailStatus: string;
  bestSeries: string | null;
  tema: string | null;
  personalizationHook: string | null;
  emailSubject: string;
  emailBody: string;
  personalizedNote: string;
  routeLink: string;
  status: CreatorStatus;
  sentAt: string | null;
  followUpSentAt: string | null;
  replyReceivedAt: string | null;
  replySnippet: string | null;
  bouncedAt: string | null;
  sourceNotes: string | null;
  followupDue: boolean; // calculado: enviado, sin respuesta, > N días, sin seguimiento
}

function mapRow(r: Record<string, unknown>, followupDays: number): CreatorRow {
  const sentAt = (r.sent_at as string) ?? null;
  const status = r.status as CreatorStatus;
  let followupDue = false;
  if (status === "enviado" && !r.reply_received_at && !r.follow_up_sent_at && sentAt) {
    const ageDays = (Date.now() - new Date(sentAt).getTime()) / 86_400_000;
    followupDue = ageDays >= followupDays;
  }
  return {
    id: r.id as string,
    name: r.name as string,
    niche: (r.niche as string) ?? null,
    language: (r.language as string) ?? null,
    youtubeUrl: (r.youtube_url as string) ?? null,
    youtubeHandle: (r.youtube_handle as string) ?? null,
    subscribersEstimate: (r.subscribers_estimate as string) ?? null,
    instagramHandle: (r.instagram_handle as string) ?? null,
    instagramUrl: (r.instagram_url as string) ?? null,
    xHandle: (r.x_handle as string) ?? null,
    xUrl: (r.x_url as string) ?? null,
    email: (r.email as string) ?? null,
    emailStatus: r.email_status as string,
    bestSeries: (r.best_series as string) ?? null,
    tema: (r.tema as string) ?? null,
    personalizationHook: (r.personalization_hook as string) ?? null,
    emailSubject: (r.email_subject as string) ?? "",
    emailBody: (r.email_body as string) ?? "",
    personalizedNote: (r.personalized_note as string) ?? "",
    routeLink: (r.route_link as string) ?? "",
    status,
    sentAt,
    followUpSentAt: (r.follow_up_sent_at as string) ?? null,
    replyReceivedAt: (r.reply_received_at as string) ?? null,
    replySnippet: (r.reply_snippet as string) ?? null,
    bouncedAt: (r.bounced_at as string) ?? null,
    sourceNotes: (r.source_notes as string) ?? null,
    followupDue,
  };
}

// ── Config / estado ───────────────────────────────────────────────────────────

export async function crmGetConfig(token: string): Promise<CrmConfig | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

  // ¿Existen las tablas? Probamos un head-count sobre creators.
  const probe = await sb.from("creators").select("id", { count: "exact", head: true });
  const tablesReady = !probe.error;

  const counts: Record<string, number> = {};
  let sentToday = 0;
  if (tablesReady) {
    const { data } = await sb.from("creators").select("status");
    for (const r of data || []) counts[r.status as string] = (counts[r.status as string] ?? 0) + 1;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count } = await sb
      .from("creator_touches")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("direction", "out")
      .gte("occurred_at", startOfDay.toISOString());
    sentToday = count ?? 0;
  }

  return {
    resendConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    fromAddress: process.env.EMAIL_FROM || null,
    tablesReady,
    dailyCap: DEFAULT_DAILY_CAP,
    sentToday,
    followupDays: DEFAULT_FOLLOWUP_DAYS,
    followupTemplate: tablesReady ? await getFollowupTemplate() : DEFAULT_FOLLOWUP_TEMPLATE,
    counts,
  };
}

// ── Importación por pegado de JSON (sin API) ──────────────────────────────────

export interface ImportResult {
  ok: boolean;
  error?: string;
  inserted?: number;
  updated?: number;
  batchId?: string;
}

export async function crmImportBatch(token: string, jsonText: string): Promise<ImportResult> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "El texto no es JSON válido. Revisa que pegaste el archivo completo." };
  }

  const root = parsed as { batch?: Record<string, unknown>; creators?: unknown };
  if (!root || typeof root !== "object" || !Array.isArray(root.creators)) {
    return { ok: false, error: "Falta el arreglo 'creators'. ¿Pegaste el JSON correcto?" };
  }
  const creators = root.creators as Array<Record<string, unknown>>;
  if (creators.length === 0) return { ok: false, error: "El lote no trae creadores." };

  // Validación mínima de cada creador antes de tocar la base.
  for (let i = 0; i < creators.length; i++) {
    const c = creators[i];
    if (!c || typeof c !== "object") return { ok: false, error: `El creador #${i + 1} no es un objeto válido.` };
    if (!c.id || typeof c.id !== "string") return { ok: false, error: `El creador #${i + 1} no tiene 'id' (string).` };
    if (!c.name || typeof c.name !== "string") return { ok: false, error: `El creador '${String(c.id)}' no tiene 'name'.` };
  }

  const sb = supabaseAdmin();
  const batch = root.batch || {};

  // 1) Crear el batch.
  const { data: batchRow, error: batchErr } = await sb
    .from("outreach_batches")
    .insert({
      niche: (batch.niche as string) ?? null,
      language: (batch.language as string) ?? null,
      requested_count: (batch.requested_count as number) ?? null,
      delivered_count: (batch.delivered_count as number) ?? creators.length,
      research_notes: (batch.research_notes as string) ?? null,
    })
    .select("id")
    .single();
  if (batchErr || !batchRow) return { ok: false, error: "No se pudo crear el lote. ¿Corriste creators-crm-setup.sql?" };
  const batchId = batchRow.id as string;

  // 2) Saber cuáles ya existen para no pisar el trabajo del admin (edits/estado).
  const ids = creators.map(c => String(c.id));
  const { data: existing } = await sb.from("creators").select("id").in("id", ids);
  const existingIds = new Set((existing || []).map(r => r.id as string));

  let inserted = 0;
  let updated = 0;
  const validEmailStatus = (v: unknown) =>
    v === "found" || v === "guessed" ? (v as string) : "not_found";

  for (const c of creators) {
    const id = String(c.id);
    const yt = (c.youtube_channel as Record<string, unknown>) || {};
    const ig = (c.instagram as Record<string, unknown>) || {};
    const x = (c.x as Record<string, unknown>) || {};
    const email = (c.email as string) || null;

    // Campos de investigación: se refrescan en cada import.
    const research = {
      batch_id: batchId,
      name: c.name as string,
      niche: (c.niche as string) ?? null,
      language: (c.language as string) ?? null,
      youtube_url: (yt.url as string) ?? null,
      youtube_handle: (yt.handle as string) ?? null,
      subscribers_estimate: (yt.subscribers_estimate as string) ?? null,
      instagram_handle: (ig.handle as string) ?? null,
      instagram_url: (ig.url as string) ?? null,
      x_handle: (x.handle as string) ?? null,
      x_url: (x.url as string) ?? null,
      email,
      email_status: validEmailStatus(c.email_status),
      best_series: (c.best_series_to_convert as string) ?? null,
      tema: (c.tema as string) ?? null,
      personalization_hook: (c.personalization_hook as string) ?? null,
      channel_priority: (c.channel_priority as unknown) ?? null,
      source_notes: (c.source_notes as string) ?? null,
      updated_at: new Date().toISOString(),
    };

    if (existingIds.has(id)) {
      // Existe: solo refrescamos investigación, preservamos plantilla/nota/link/estado.
      const { error } = await sb.from("creators").update(research).eq("id", id);
      if (!error) updated++;
    } else {
      // Nuevo: insert completo con plantilla y estado inicial derivado del email.
      const initialStatus: CreatorStatus = isValidEmail(email) ? "investigado" : "solo_manual";
      const { error } = await sb.from("creators").insert({
        id,
        ...research,
        email_subject: (c.email_subject as string) ?? "",
        email_body: (c.email_body as string) ?? "",
        personalized_note: (c.personalized_note as string) ?? "",
        route_link: (c.route_link as string) ?? "",
        status: initialStatus,
      });
      if (!error) inserted++;
    }
  }

  return { ok: true, inserted, updated, batchId };
}

// ── Listado ───────────────────────────────────────────────────────────────────

export interface ListFilters {
  status?: string;       // "" = todos
  niche?: string;        // "" = todos
  hasEmail?: "yes" | "no" | "";
  search?: string;
  followupDue?: boolean; // solo los que tocan seguimiento
}

export async function crmListCreators(token: string, filters: ListFilters = {}): Promise<CreatorRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  let q = sb.from("creators").select("*").order("created_at", { ascending: true }).limit(500);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.niche) q = q.eq("niche", filters.niche);
  if (filters.hasEmail === "yes") q = q.not("email", "is", null);
  if (filters.hasEmail === "no") q = q.is("email", null);
  const term = (filters.search || "").trim();
  if (term) q = q.ilike("name", `%${term}%`);

  const { data, error } = await q;
  if (error) return [];
  let rows = (data || []).map(r => mapRow(r, DEFAULT_FOLLOWUP_DAYS));
  if (filters.followupDue) rows = rows.filter(r => r.followupDue);
  return rows;
}

// ── Edición por fila ──────────────────────────────────────────────────────────

export interface CreatorPatch {
  emailSubject?: string;
  emailBody?: string;
  personalizedNote?: string;
  routeLink?: string;
  email?: string;            // editable a mano: fijar/cambiar/limpiar el correo
  status?: CreatorStatus;
}

export async function crmUpdateCreator(
  token: string,
  id: string,
  patch: CreatorPatch
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.emailSubject !== undefined) upd.email_subject = patch.emailSubject;
  if (patch.emailBody !== undefined) upd.email_body = patch.emailBody;
  if (patch.personalizedNote !== undefined) upd.personalized_note = patch.personalizedNote;
  if (patch.routeLink !== undefined) upd.route_link = patch.routeLink;
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) return { ok: false, error: "Estado no válido." };
    upd.status = patch.status;
  }

  // Correo manual: vacío → lo limpia; con texto → debe ser un email válido.
  if (patch.email !== undefined) {
    const e = patch.email.trim();
    if (e && !isValidEmail(e)) return { ok: false, error: "El correo no tiene un formato válido." };
    upd.email = e || null;
    upd.email_status = e ? "found" : "not_found";
    // Si estaba 'solo_manual' por no tener correo y ahora sí tiene uno válido,
    // lo subimos a 'investigado' (salvo que el patch ya traiga un status explícito).
    if (e && patch.status === undefined) {
      const { data: cur } = await sb.from("creators").select("status").eq("id", id).single();
      if (cur?.status === "solo_manual") upd.status = "investigado";
    }
  }

  const { error } = await sb.from("creators").update(upd).eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar." };
  return { ok: true };
}

/** Borra un creador (y su bitácora, vía cascade). Para limpiar la vista. */
export async function crmDeleteCreator(token: string, id: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb.from("creators").delete().eq("id", id);
  return { ok: !error };
}

/** Valida las reglas duras y, si pasan, marca 'listo'. Devuelve el motivo si no. */
export async function crmApproveCreator(token: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("creators")
    .select("email, personalized_note, route_link, email_subject, email_body")
    .eq("id", id)
    .single();
  if (error || !data) return { ok: false, error: "No se encontró el creador." };

  const reason = approvalReason(data);
  if (reason) return { ok: false, error: reason };

  const { error: e2 } = await sb.from("creators").update({ status: "listo", updated_at: new Date().toISOString() }).eq("id", id);
  if (e2) return { ok: false, error: "No se pudo aprobar." };
  return { ok: true };
}

/** Regla dura compartida: email válido + nota + link + plantilla no vacía. */
function approvalReason(d: Record<string, unknown>): string | null {
  if (!isValidEmail(d.email as string)) return "El creador no tiene un email válido.";
  if (!((d.personalized_note as string) || "").trim()) return "Falta la nota personalizada.";
  if (!((d.route_link as string) || "").trim()) return "Falta el enlace de la ruta.";
  if (!((d.email_subject as string) || "").trim()) return "El asunto está vacío.";
  if (!((d.email_body as string) || "").trim()) return "El cuerpo del correo está vacío.";
  return null;
}

// ── Envío de UN correo (lo orquesta el panel, uno por uno, con throttle) ──────

export interface SendOneResult {
  ok: boolean;
  error?: string;
  capReached?: boolean; // se alcanzó el tope diario; el panel debe detenerse
}

async function sentTodayCount(): Promise<number> {
  const sb = supabaseAdmin();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await sb
    .from("creator_touches")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email")
    .eq("direction", "out")
    .gte("occurred_at", startOfDay.toISOString());
  return count ?? 0;
}

/** Envía el correo inicial a un creador en 'listo'. Renderiza su plantilla. */
export async function crmSendOne(token: string, id: string): Promise<SendOneResult> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  // Tope diario (defensa de servidor: el panel también lo respeta).
  if ((await sentTodayCount()) >= DEFAULT_DAILY_CAP) {
    return { ok: false, capReached: true, error: `Tope diario alcanzado (${DEFAULT_DAILY_CAP}).` };
  }

  const { data: c, error } = await sb.from("creators").select("*").eq("id", id).single();
  if (error || !c) return { ok: false, error: "No se encontró el creador." };
  if (c.status !== "listo") return { ok: false, error: "Solo se envían filas aprobadas (en 'listo')." };

  const reason = approvalReason(c);
  if (reason) return { ok: false, error: reason };

  const vars: MergeVars = {
    name: c.name as string,
    tema: (c.tema as string) || "",
    personalized_note: (c.personalized_note as string) || "",
    route_link: (c.route_link as string) || "",
  };
  const subject = renderTemplate(c.email_subject as string, vars).trim();
  const bodyText = renderTemplate(c.email_body as string, vars);

  const sig = await getSignature();
  const html = htmlFromText(bodyText) + sig;
  const fullText = `${bodyText}\n\n${stripHtml(sig)}`;
  const to = (c.email as string).trim();

  const result = await sendEmail({ to, subject, text: fullText, html });

  // Guardamos también en la bandeja de Correos (historial unificado).
  await sb.from("emails").insert({
    direction: "outbound",
    from_addr: process.env.EMAIL_FROM || "no-reply",
    to_addr: to,
    subject,
    body_text: fullText,
    body_html: html,
    status: result.ok ? "sent" : "failed",
    provider_id: result.id ?? null,
    raw: result.ok ? { id: result.id, creator_id: id } : { error: result.error, creator_id: id },
  });

  if (!result.ok) return { ok: false, error: result.error || "No se pudo enviar." };

  await sb.from("creators").update({
    status: "enviado",
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  await sb.from("creator_touches").insert({
    creator_id: id, channel: "email", direction: "out", note: `Envío inicial · "${subject}"`,
  });

  return { ok: true };
}

/** Envía el seguimiento (un solo toque) a un creador en 'enviado'. */
export async function crmSendFollowup(token: string, id: string): Promise<SendOneResult> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  if ((await sentTodayCount()) >= DEFAULT_DAILY_CAP) {
    return { ok: false, capReached: true, error: `Tope diario alcanzado (${DEFAULT_DAILY_CAP}).` };
  }

  const { data: c, error } = await sb.from("creators").select("*").eq("id", id).single();
  if (error || !c) return { ok: false, error: "No se encontró el creador." };
  if (c.status !== "enviado") return { ok: false, error: "El seguimiento es solo para filas ya enviadas sin respuesta." };
  if (c.follow_up_sent_at) return { ok: false, error: "Ya se envió el único seguimiento permitido." };
  if (!isValidEmail(c.email as string)) return { ok: false, error: "Email no válido." };

  const vars: MergeVars = {
    name: c.name as string,
    tema: (c.tema as string) || "",
    personalized_note: (c.personalized_note as string) || "",
    route_link: (c.route_link as string) || "",
  };
  const tpl = await getFollowupTemplate();
  const bodyText = renderTemplate(tpl, vars);
  const subject = renderTemplate(c.email_subject as string, vars).trim();
  const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;

  const sig = await getSignature();
  const html = htmlFromText(bodyText) + sig;
  const fullText = `${bodyText}\n\n${stripHtml(sig)}`;
  const to = (c.email as string).trim();

  const result = await sendEmail({ to, subject: replySubject, text: fullText, html });
  await sb.from("emails").insert({
    direction: "outbound",
    from_addr: process.env.EMAIL_FROM || "no-reply",
    to_addr: to,
    subject: replySubject,
    body_text: fullText,
    body_html: html,
    status: result.ok ? "sent" : "failed",
    provider_id: result.id ?? null,
    raw: result.ok ? { id: result.id, creator_id: id, followup: true } : { error: result.error, creator_id: id },
  });

  if (!result.ok) return { ok: false, error: result.error || "No se pudo enviar." };

  await sb.from("creators").update({
    status: "seguimiento_enviado",
    follow_up_sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  await sb.from("creator_touches").insert({
    creator_id: id, channel: "email", direction: "out", note: "Seguimiento (único toque)",
  });

  return { ok: true };
}

// ── Bitácora ──────────────────────────────────────────────────────────────────

export interface TouchRow {
  id: string;
  channel: string;
  direction: string;
  note: string | null;
  occurredAt: string;
}

export async function crmGetTouches(token: string, creatorId: string): Promise<TouchRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("creator_touches")
    .select("id, channel, direction, note, occurred_at")
    .eq("creator_id", creatorId)
    .order("occurred_at", { ascending: false });
  return (data || []).map(t => ({
    id: t.id as string,
    channel: t.channel as string,
    direction: t.direction as string,
    note: (t.note as string) ?? null,
    occurredAt: t.occurred_at as string,
  }));
}

/** Registra un toque manual (p. ej. "le escribí por Instagram"). */
export async function crmAddTouch(
  token: string,
  creatorId: string,
  channel: "email" | "instagram" | "x" | "youtube",
  direction: "out" | "in",
  note: string
): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb.from("creator_touches").insert({ creator_id: creatorId, channel, direction, note });
  return { ok: !error };
}

// ── Plantilla de seguimiento (persistida en app_settings) ─────────────────────

export async function crmSetFollowupTemplate(token: string, tpl: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: FOLLOWUP_TPL_KEY, value: tpl, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return { ok: !error };
}
