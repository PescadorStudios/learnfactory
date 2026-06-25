"use server";

// Server actions de Campañas a usuarios registrados. Solo para perfiles role='admin'.
// Flujo: el admin redacta un correo (a mano o con ayuda de Gemini), lo GUARDA CON
// UN NOMBRE, ve la lista de usuarios con el curso que empezaron y no terminaron
// (+ su % de avance) y envía en lote con la MISMA firma, dirección (EMAIL_FROM) y
// throttle (pausa entre correos) que el CRM de creadores. Cada envío queda en la
// bandeja unificada (public.emails) y en la bitácora (user_campaign_sends).

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { sendEmail, htmlFromText } from "@/lib/email/resend";
import { DEFAULT_SIGNATURE } from "@/lib/email/signature";
import { renderUserTemplate, isValidEmail, type UserMergeVars } from "@/lib/crm/render";
import { getBaseUrl } from "@/lib/routeJobs";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function requireAdmin(token: string): Promise<{ id: string } | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const { data } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (data?.role !== "admin") return null;
  return { id: user.id };
}

// Tope diario de envíos a usuarios (cuida la reputación de la dirección). Estos
// son usuarios YA registrados (lista cálida), por eso es algo más alto que el de
// creadores (25). Ajustable aquí.
const DEFAULT_DAILY_CAP = 60;
const SIG_KEY = "email_signature";
const AVATAR_BUCKET = "avatars";

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

async function sentTodayCount(): Promise<number> {
  const sb = supabaseAdmin();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await sb
    .from("user_campaign_sends")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", startOfDay.toISOString());
  return count ?? 0;
}

// ── Tipos expuestos al cliente ────────────────────────────────────────────────

export interface UcConfig {
  resendConfigured: boolean;
  fromAddress: string | null;
  tablesReady: boolean;
  geminiReady: boolean;
  dailyCap: number;
  sentToday: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: string;
}

export interface UcCourse {
  routeId: string;
  topic: string;
  completionPct: number;
  link: string;
}

export interface UcUserRow {
  id: string;
  name: string;        // nombre resuelto (display_name / username / local del email)
  email: string;
  avatarUrl: string | null;
  inProgress: UcCourse[];     // cursos empezados y NO terminados (pct < 100)
  suggested: UcCourse | null; // el de actividad más reciente → llena los merge fields
  alreadySent: boolean;       // ya recibió esta campaña (si se pasó campaignId)
}

// ── Config / estado ───────────────────────────────────────────────────────────

export async function ucGetConfig(token: string): Promise<UcConfig | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

  // ¿Existen las tablas? Probamos un head-count sobre user_campaigns.
  const probe = await sb.from("user_campaigns").select("id", { count: "exact", head: true });
  const tablesReady = !probe.error;

  return {
    resendConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    fromAddress: process.env.EMAIL_FROM || null,
    tablesReady,
    geminiReady: Boolean(process.env.GEMINI_API_KEY),
    dailyCap: DEFAULT_DAILY_CAP,
    sentToday: tablesReady ? await sentTodayCount() : 0,
  };
}

// ── Campañas guardadas (CRUD) ─────────────────────────────────────────────────

export async function ucListCampaigns(token: string): Promise<CampaignRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("user_campaigns")
    .select("id, name, subject, body, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data || []).map(r => ({
    id: r.id as string,
    name: r.name as string,
    subject: (r.subject as string) ?? "",
    body: (r.body as string) ?? "",
    updatedAt: r.updated_at as string,
  }));
}

export interface SaveCampaignInput {
  id?: string;     // si viene, actualiza; si no, crea
  name: string;
  subject: string;
  body: string;
}

export async function ucSaveCampaign(
  token: string,
  input: SaveCampaignInput
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "Ponle un nombre a la campaña para guardarla." };
  const subject = (input.subject || "").trim();
  const body = input.body || "";
  if (!subject) return { ok: false, error: "El asunto no puede estar vacío." };
  if (!body.trim()) return { ok: false, error: "El cuerpo no puede estar vacío." };

  if (input.id) {
    const { error } = await sb
      .from("user_campaigns")
      .update({ name, subject, body, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (error) return { ok: false, error: "No se pudo guardar." };
    return { ok: true, id: input.id };
  }

  const { data, error } = await sb
    .from("user_campaigns")
    .insert({ name, subject, body })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No se pudo crear la campaña. ¿Corriste user-campaigns-setup.sql?" };
  return { ok: true, id: data.id as string };
}

export async function ucDeleteCampaign(token: string, id: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb.from("user_campaigns").delete().eq("id", id);
  return { ok: !error };
}

// ── Redacción con Gemini (guiada por el prompt del admin) ─────────────────────

export interface GenerateInput {
  prompt: string;            // instrucción del admin sobre qué correo quiere
  currentSubject?: string;   // borrador actual (para "mejóralo")
  currentBody?: string;
}

export async function ucGenerateWithGemini(
  token: string,
  input: GenerateInput
): Promise<{ ok: boolean; error?: string; subject?: string; body?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta GEMINI_API_KEY en el entorno." };
  const instruction = (input.prompt || "").trim();
  if (!instruction) return { ok: false, error: "Escribe qué correo quieres que redacte." };

  const draft = (input.currentSubject || input.currentBody)
    ? `\n\nBORRADOR ACTUAL (mejóralo o reescríbelo según la instrucción):\nAsunto: ${input.currentSubject || "(vacío)"}\nCuerpo:\n${input.currentBody || "(vacío)"}`
    : "";

  const prompt = `Eres un copywriter experto de Learn Factory, una plataforma para aprender cualquier tema con IA y gamificación. Vas a redactar un correo de RE-ENGANCHE en español para invitar a un usuario YA REGISTRADO a TERMINAR un curso que empezó y dejó a medias.

VOZ: hablas como Mauricio Duque, fundador de Learn Factory. Cercano, humano, directo, cero corporativo. Tuteas. Frases cortas.

MERGE FIELDS disponibles (úsalos de forma natural; el sistema los reemplaza por fila):
- {{nombre}} → nombre del usuario
- {{curso}} → título del curso que dejó a medias
- {{progreso}} → su porcentaje de avance, ej. "35%"
- {{enlace}} → enlace para retomar el curso (ponlo en su propia línea)

REGLAS:
- NO incluyas firma, despedida con nombre, ni datos de contacto: la firma se añade automáticamente al final.
- Texto plano (sin HTML, sin markdown, sin asteriscos).
- Entre 90 y 160 palabras. Un solo llamado a la acción claro: retomar el curso con {{enlace}}.
- Empieza saludando con {{nombre}} y menciona {{curso}} y {{progreso}}.

INSTRUCCIÓN DEL ADMIN (manda sobre el tono/ángulo/contenido): ${instruction}${draft}

Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta forma exacta:
{ "subject": "asunto corto y atractivo (puede usar {{nombre}} o {{curso}})", "body": "cuerpo del correo en texto plano" }`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 },
    });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    let parsed: { subject?: string; body?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
    }
    const subject = (parsed.subject || "").trim();
    const body = (parsed.body || "").trim();
    if (!subject || !body) return { ok: false, error: "Gemini no devolvió un correo completo. Reintenta." };
    return { ok: true, subject, body };
  } catch (e) {
    console.warn("[UserCampaigns] Gemini falló:", e);
    return { ok: false, error: "No se pudo generar con Gemini. Reintenta en un momento." };
  }
}

// ── Cálculo de cursos "a medias" por usuario (en lote) ────────────────────────
// Devuelve, por usuario, los cursos que EMPEZÓ (route_starts o intentos) y NO ha
// terminado (avance < 100%), ordenados por actividad más reciente. El primero es
// la "sugerencia" que llena los merge fields del correo.

async function computeInProgress(
  sb: ReturnType<typeof supabaseAdmin>,
  userIds: string[]
): Promise<Map<string, UcCourse[]>> {
  const out = new Map<string, UcCourse[]>();
  if (userIds.length === 0) return out;
  const base = getBaseUrl();

  const [{ data: starts }, { data: attempts }] = await Promise.all([
    sb.from("route_starts").select("user_id, route_id, started_at").in("user_id", userIds),
    sb.from("attempts").select("user_id, route_id, node_id, passed, created_at").in("user_id", userIds),
  ]);

  const routeIds = [
    ...new Set([
      ...(starts || []).map(s => s.route_id as string),
      ...(attempts || []).map(a => a.route_id as string),
    ]),
  ];
  if (routeIds.length === 0) {
    userIds.forEach(u => out.set(u, []));
    return out;
  }

  const [{ data: routes }, { data: lessons }] = await Promise.all([
    sb.from("routes").select("id, topic, blocked").in("id", routeIds),
    sb.from("lessons").select("route_id").in("route_id", routeIds),
  ]);

  // Solo cursos vigentes (no bloqueados): no invitamos a algo fuera del aire.
  const routeMap = new Map(
    (routes || []).filter(r => !r.blocked).map(r => [r.id as string, r])
  );
  const totalByRoute = new Map<string, number>();
  for (const l of lessons || []) {
    totalByRoute.set(l.route_id as string, (totalByRoute.get(l.route_id as string) ?? 0) + 1);
  }

  // key = `${userId}|${routeId}`
  const passedNodes = new Map<string, Set<string>>();
  const lastAct = new Map<string, string>();
  const startedAt = new Map<string, string>();
  const pairs = new Map<string, Set<string>>(); // userId → set(routeId)
  const addPair = (u: string, r: string) => {
    if (!pairs.has(u)) pairs.set(u, new Set());
    pairs.get(u)!.add(r);
  };

  for (const a of attempts || []) {
    const u = a.user_id as string, r = a.route_id as string;
    const k = `${u}|${r}`;
    addPair(u, r);
    const created = a.created_at as string | null;
    if (created && (!lastAct.has(k) || created > lastAct.get(k)!)) lastAct.set(k, created);
    if (a.passed) {
      if (!passedNodes.has(k)) passedNodes.set(k, new Set());
      passedNodes.get(k)!.add(a.node_id as string);
    }
  }
  for (const s of starts || []) {
    const u = s.user_id as string, r = s.route_id as string;
    startedAt.set(`${u}|${r}`, s.started_at as string);
    addPair(u, r);
  }

  for (const uid of userIds) {
    const rs = pairs.get(uid);
    const scored: Array<{ course: UcCourse; sortKey: string }> = [];
    if (rs) {
      for (const rid of rs) {
        const route = routeMap.get(rid);
        if (!route) continue; // bloqueado o inexistente
        const k = `${uid}|${rid}`;
        const total = totalByRoute.get(rid) ?? 0;
        const completed = passedNodes.get(k)?.size ?? 0;
        const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        if (pct >= 100) continue; // ya lo terminó → no es "a medias"
        scored.push({
          course: { routeId: rid, topic: route.topic as string, completionPct: pct, link: `${base}/route/${rid}` },
          sortKey: lastAct.get(k) || startedAt.get(k) || "",
        });
      }
    }
    scored.sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""));
    out.set(uid, scored.map(s => s.course));
  }
  return out;
}

function resolveName(p: { display_name?: string | null; username?: string | null; email?: string | null }): string {
  const dn = (p.display_name || "").trim();
  if (dn) return dn;
  if (p.username) return p.username;
  if (p.email) return p.email.split("@")[0];
  return "";
}

// ── Listado de usuarios (con su curso a medias y % de avance) ─────────────────

export interface UcListFilters {
  search?: string;
  onlyInProgress?: boolean; // solo usuarios con curso empezado sin terminar
  campaignId?: string;      // para marcar quién ya recibió esta campaña
}

export async function ucListUsers(token: string, filters: UcListFilters = {}): Promise<UcUserRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  let q = sb
    .from("profiles")
    .select("id, email, username, display_name, avatar_path, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const term = (filters.search || "").trim();
  if (term) q = q.or(`email.ilike.%${term}%,username.ilike.%${term}%,display_name.ilike.%${term}%`);

  const { data: profiles } = await q;
  const rows = profiles || [];
  const ids = rows.map(r => r.id as string);
  if (ids.length === 0) return [];

  const progressMap = await computeInProgress(sb, ids);

  // ¿Quién ya recibió esta campaña? (para evitar reenviar sin querer)
  const sentSet = new Set<string>();
  if (filters.campaignId) {
    const { data: sends } = await sb
      .from("user_campaign_sends")
      .select("user_id")
      .eq("campaign_id", filters.campaignId)
      .eq("status", "sent")
      .in("user_id", ids);
    for (const s of sends || []) sentSet.add(s.user_id as string);
  }

  let result: UcUserRow[] = rows.map(r => {
    const inProgress = progressMap.get(r.id as string) || [];
    return {
      id: r.id as string,
      name: resolveName(r),
      email: r.email as string,
      avatarUrl: r.avatar_path
        ? sb.storage.from(AVATAR_BUCKET).getPublicUrl(r.avatar_path as string).data.publicUrl
        : null,
      inProgress,
      suggested: inProgress[0] ?? null,
      alreadySent: sentSet.has(r.id as string),
    };
  });

  if (filters.onlyInProgress) result = result.filter(u => u.inProgress.length > 0);
  return result;
}

// ── Envío de UN correo (lo orquesta el panel, uno por uno, con throttle) ──────

export interface UcSendResult {
  ok: boolean;
  error?: string;
  capReached?: boolean;
}

export async function ucSendOne(
  token: string,
  campaignId: string,
  userId: string
): Promise<UcSendResult> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  // Tope diario (defensa de servidor: el panel también lo respeta).
  if ((await sentTodayCount()) >= DEFAULT_DAILY_CAP) {
    return { ok: false, capReached: true, error: `Tope diario alcanzado (${DEFAULT_DAILY_CAP}).` };
  }

  const { data: campaign, error: cErr } = await sb
    .from("user_campaigns").select("subject, body").eq("id", campaignId).single();
  if (cErr || !campaign) return { ok: false, error: "No se encontró la campaña." };

  const { data: profile, error: pErr } = await sb
    .from("profiles").select("id, email, username, display_name").eq("id", userId).single();
  if (pErr || !profile) return { ok: false, error: "No se encontró el usuario." };
  const to = (profile.email as string || "").trim();
  if (!isValidEmail(to)) return { ok: false, error: "El usuario no tiene un correo válido." };

  // Curso a medias (el de actividad más reciente) → llena los merge fields.
  const inProgress = (await computeInProgress(sb, [userId])).get(userId) || [];
  const suggested = inProgress[0] ?? null;

  const tplText = `${campaign.subject}\n${campaign.body}`;
  const usesCurso = /\{\{\s*(curso|enlace|progreso)\s*\}\}/.test(tplText);
  if (usesCurso && !suggested) {
    return { ok: false, error: "El usuario no tiene un curso a medias para personalizar." };
  }

  const vars: UserMergeVars = {
    nombre: resolveName(profile),
    curso: suggested?.topic || "",
    progreso: suggested ? `${suggested.completionPct}%` : "",
    enlace: suggested?.link || "",
  };
  const subject = renderUserTemplate(campaign.subject as string, vars).trim();
  const bodyText = renderUserTemplate(campaign.body as string, vars);

  const sig = await getSignature();
  const html = htmlFromText(bodyText) + sig;
  const fullText = `${bodyText}\n\n${stripHtml(sig)}`;

  const result = await sendEmail({ to, subject, text: fullText, html });

  // Historial unificado (bandeja de Correos).
  await sb.from("emails").insert({
    direction: "outbound",
    from_addr: process.env.EMAIL_FROM || "no-reply",
    to_addr: to,
    subject,
    body_text: fullText,
    body_html: html,
    status: result.ok ? "sent" : "failed",
    provider_id: result.id ?? null,
    raw: result.ok
      ? { id: result.id, campaign_id: campaignId, user_id: userId }
      : { error: result.error, campaign_id: campaignId, user_id: userId },
  });

  // Bitácora propia (tope diario + dedupe + historial por usuario).
  await sb.from("user_campaign_sends").insert({
    campaign_id: campaignId,
    user_id: userId,
    route_id: suggested?.routeId ?? null,
    subject,
    status: result.ok ? "sent" : "failed",
  });

  if (!result.ok) return { ok: false, error: result.error || "No se pudo enviar." };
  return { ok: true };
}
