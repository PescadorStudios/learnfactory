"use server";

// Server actions de Campañas a usuarios registrados. Solo para perfiles role='admin'.
// Flujo: el admin redacta un correo (a mano o con ayuda de Gemini, que puede leer
// la SÍNTESIS de una ruta para escribir contenido de valor), lo GUARDA CON UN
// NOMBRE (opcionalmente atado a una RUTA OBJETIVO), segmenta a los usuarios por
// ruta/estado/tiempo y envía en lote con la MISMA firma, dirección (EMAIL_FROM) y
// throttle que el CRM de creadores. Cada envío queda en la bandeja unificada
// (public.emails) y en la bitácora (user_campaign_sends).

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { sendEmail, htmlFromText } from "@/lib/email/resend";
import { DEFAULT_SIGNATURE } from "@/lib/email/signature";
import { renderUserTemplate, isValidEmail, type UserMergeVars } from "@/lib/crm/render";
import { getBaseUrl } from "@/lib/routeJobs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Sintesis } from "@/lib/types";

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

// Umbral de "completado" para campañas (mismo criterio de graduación del sistema,
// src/lib/reputation.ts): pasar ≥80% de las lecciones cuenta como terminado.
const GRADUATE_THRESHOLD = 0.8;
// "Terminó rápido" por defecto (para el stat completedFast): ≤ N días.
const DEFAULT_FAST_DAYS = 7;
// Tope práctico del universo de usuarios de una vista (la selección manual no
// tiene tope: "seleccionar todos" opera sobre TODO el universo filtrado).
const USER_UNIVERSE_CAP = 5000;
const DEFAULT_PAGE_SIZE = 60;
// Cota dura del contexto de ruta que se le pasa a Gemini (limita tokens).
const MAX_ROUTE_CONTEXT_CHARS = 8000;

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

function resolveName(p: { display_name?: string | null; username?: string | null; email?: string | null }): string {
  const dn = (p.display_name || "").trim();
  if (dn) return dn;
  if (p.username) return p.username;
  if (p.email) return p.email.split("@")[0];
  return "";
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
  targetRouteId: string | null;
  updatedAt: string;
}

export interface UcCourse {
  routeId: string;
  topic: string;
  completionPct: number;
  link: string;
}

export type RouteState = "in_progress" | "completed" | "not_started";

export interface UcUserRow {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  allRoutes: UcCourse[];      // TODA ruta empezada/intentada (incl. 100%)
  inProgress: UcCourse[];     // subset con pct < 100
  suggested: UcCourse | null; // el de actividad más reciente (merge fields en modo auto)
  targetPct: number | null;   // % en la ruta objetivo (si la campaña tiene una)
  targetState: RouteState | null;
  alreadySent: boolean;
}

export interface RouteCatalogRow {
  id: string;
  topic: string;
  studentCount: number;
}

export interface RouteAudienceStats {
  total: number;
  inProgress: number;
  completed: number;
  notStarted: number;
  avgPct: number;
  completedFast: number; // completados en ≤ DEFAULT_FAST_DAYS días
}

// ── Config / estado ───────────────────────────────────────────────────────────

export async function ucGetConfig(token: string): Promise<UcConfig | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

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

// ── Catálogo de rutas (para el selector y el flujo IA) ────────────────────────

export async function ucListRoutes(token: string): Promise<RouteCatalogRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("routes")
    .select("id, topic, student_count")
    .eq("blocked", false)
    .order("student_count", { ascending: false })
    .limit(500);
  if (error) return [];
  return (data || []).map(r => ({
    id: r.id as string,
    topic: r.topic as string,
    studentCount: (r.student_count as number) ?? 0,
  }));
}

// ── Campañas guardadas (CRUD) ─────────────────────────────────────────────────

export async function ucListCampaigns(token: string): Promise<CampaignRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("user_campaigns")
    .select("id, name, subject, body, target_route_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data || []).map(r => ({
    id: r.id as string,
    name: r.name as string,
    subject: (r.subject as string) ?? "",
    body: (r.body as string) ?? "",
    targetRouteId: (r.target_route_id as string) ?? null,
    updatedAt: r.updated_at as string,
  }));
}

export interface SaveCampaignInput {
  id?: string;
  name: string;
  subject: string;
  body: string;
  targetRouteId?: string | null;
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
  const targetRouteId = input.targetRouteId || null;

  if (input.id) {
    const { error } = await sb
      .from("user_campaigns")
      .update({ name, subject, body, target_route_id: targetRouteId, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (error) return { ok: false, error: "No se pudo guardar." };
    return { ok: true, id: input.id };
  }

  const { data, error } = await sb
    .from("user_campaigns")
    .insert({ name, subject, body, target_route_id: targetRouteId })
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

// ── Contexto de una ruta para la IA (síntesis + títulos de lecciones) ─────────

interface RouteAiContext {
  routeId: string;
  topic: string;
  description: string | null;
  tesisGlobal: string;
  conceptos: { nombre: string; definicion: string }[];
  lessonTitles: string[];
  advertencias: string[];
}

async function buildRouteContext(
  sb: ReturnType<typeof supabaseAdmin>,
  routeId: string
): Promise<RouteAiContext | null> {
  const { data: route } = await sb
    .from("routes")
    .select("id, topic, description, sintesis, blocked")
    .eq("id", routeId)
    .single();
  if (!route || route.blocked) return null;

  const { data: lessons } = await sb
    .from("lessons")
    .select("title, node_type")
    .eq("route_id", routeId);

  const sintesis = (route.sintesis as Sintesis) || { tesisGlobal: "", conceptos: [], advertenciasDeContexto: [] };

  let conceptos = (sintesis.conceptos || [])
    .map(c => ({ nombre: c.nombre || "", definicion: (c.definicion || "").slice(0, 200) }))
    .filter(c => c.nombre)
    .slice(0, 25);
  let lessonTitles = (lessons || [])
    .filter(l => ["theory", "practice", "boss"].includes(l.node_type as string))
    .map(l => (l.title as string) || "")
    .filter(Boolean)
    .slice(0, 40);
  const advertencias = (sintesis.advertenciasDeContexto || []).slice(0, 5);

  // Cota dura: recorta conceptos/títulos hasta que el contexto serializado quepa.
  const ctx = (): RouteAiContext => ({
    routeId,
    topic: route.topic as string,
    description: (route.description as string) ?? null,
    tesisGlobal: sintesis.tesisGlobal || "",
    conceptos,
    lessonTitles,
    advertencias,
  });
  while (JSON.stringify(ctx()).length > MAX_ROUTE_CONTEXT_CHARS && (conceptos.length > 3 || lessonTitles.length > 5)) {
    if (lessonTitles.length > 5) lessonTitles = lessonTitles.slice(0, lessonTitles.length - 5);
    else conceptos = conceptos.slice(0, conceptos.length - 2);
  }
  return ctx();
}

// ── Audiencia por ruta (stats + usuarios elegibles) ───────────────────────────

export interface RouteAudienceFilters {
  state?: "all" | RouteState;
  minPct?: number;
  maxPct?: number;
  completedWithinDays?: number;
}

interface RouteAudienceUser {
  userId: string;
  pct: number;
  state: RouteState;
  completedAt: string | null;
  daysToComplete: number | null;
}

interface RouteAudience {
  users: RouteAudienceUser[];    // ya filtrada por `filters`
  stats: RouteAudienceStats;     // sobre la población total (pre-filtro)
  byUser: Map<string, RouteAudienceUser>; // TODOS (pre-filtro), para lookups
}

function completionInfo(
  passed: Array<{ node_id: string; created_at: string | null }>,
  total: number,
  startAt: string | null
): { completedAt: string; days: number | null } | null {
  if (total <= 0) return null;
  const seen = new Set<string>();
  const sorted = [...passed].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  for (const a of sorted) {
    seen.add(a.node_id);
    if (seen.size / total >= GRADUATE_THRESHOLD) {
      const completedAt = a.created_at || "";
      const days = startAt && completedAt
        ? Math.max(0, (new Date(completedAt).getTime() - new Date(startAt).getTime()) / 86_400_000)
        : null;
      return { completedAt, days };
    }
  }
  return null;
}

async function computeRouteAudience(
  sb: ReturnType<typeof supabaseAdmin>,
  routeId: string,
  filters: RouteAudienceFilters = {}
): Promise<RouteAudience> {
  const [{ data: starts }, { data: attempts }, { count: totalLessons }] = await Promise.all([
    sb.from("route_starts").select("user_id, started_at").eq("route_id", routeId),
    sb.from("attempts").select("user_id, node_id, passed, created_at").eq("route_id", routeId).limit(50000),
    sb.from("lessons").select("id", { count: "exact", head: true }).eq("route_id", routeId),
  ]);
  const total = totalLessons ?? 0;

  const startedAt = new Map<string, string>();
  for (const s of starts || []) startedAt.set(s.user_id as string, s.started_at as string);

  const passedByUser = new Map<string, Array<{ node_id: string; created_at: string | null }>>();
  const firstAttemptAt = new Map<string, string>();
  const userIds = new Set<string>(startedAt.keys());
  for (const a of attempts || []) {
    const u = a.user_id as string;
    userIds.add(u);
    const created = (a.created_at as string) || null;
    if (created && (!firstAttemptAt.has(u) || created < firstAttemptAt.get(u)!)) firstAttemptAt.set(u, created);
    if (a.passed) {
      if (!passedByUser.has(u)) passedByUser.set(u, []);
      passedByUser.get(u)!.push({ node_id: a.node_id as string, created_at: created });
    }
  }

  const byUser = new Map<string, RouteAudienceUser>();
  let sumPct = 0, inProgress = 0, completed = 0, notStarted = 0, completedFast = 0;
  for (const u of userIds) {
    const passed = passedByUser.get(u) || [];
    const distinct = new Set(passed.map(p => p.node_id)).size;
    const pct = total > 0 ? Math.min(100, Math.round((distinct / total) * 100)) : 0;
    const isCompleted = total > 0 && distinct / total >= GRADUATE_THRESHOLD;
    const state: RouteState = isCompleted ? "completed" : distinct > 0 ? "in_progress" : "not_started";

    let completedAt: string | null = null;
    let daysToComplete: number | null = null;
    if (isCompleted) {
      const start = startedAt.get(u) || firstAttemptAt.get(u) || null;
      const info = completionInfo(passed, total, start);
      if (info) { completedAt = info.completedAt; daysToComplete = info.days; }
    }

    byUser.set(u, { userId: u, pct, state, completedAt, daysToComplete });
    sumPct += pct;
    if (state === "completed") { completed++; if (daysToComplete != null && daysToComplete <= DEFAULT_FAST_DAYS) completedFast++; }
    else if (state === "in_progress") inProgress++;
    else notStarted++;
  }

  const totalUsers = userIds.size;
  const stats: RouteAudienceStats = {
    total: totalUsers,
    inProgress, completed, notStarted,
    avgPct: totalUsers > 0 ? Math.round(sumPct / totalUsers) : 0,
    completedFast,
  };

  // Filtro del segmento.
  const state = filters.state && filters.state !== "all" ? filters.state : null;
  const minPct = filters.minPct ?? null;
  const maxPct = filters.maxPct ?? null;
  const withinDays = filters.completedWithinDays ?? null;
  const users = [...byUser.values()].filter(u => {
    if (state && u.state !== state) return false;
    if (minPct != null && u.pct < minPct) return false;
    if (maxPct != null && u.pct > maxPct) return false;
    if (withinDays != null) {
      if (u.state !== "completed") return false;
      if (u.daysToComplete == null || u.daysToComplete > withinDays) return false;
    }
    return true;
  }).sort((a, b) => b.pct - a.pct);

  return { users, stats, byUser };
}

// ── Cálculo de TODAS las rutas por usuario (en lote) ──────────────────────────
// Devuelve, por usuario, toda ruta empezada/intentada (no bloqueada) con su %,
// ordenadas por actividad más reciente. El caller deriva inProgress (<100%) y la
// sugerencia (primera en progreso).

async function computeUserRoutes(
  sb: ReturnType<typeof supabaseAdmin>,
  userIds: string[]
): Promise<Map<string, UcCourse[]>> {
  const out = new Map<string, UcCourse[]>();
  if (userIds.length === 0) return out;
  const base = getBaseUrl();

  const [{ data: starts }, { data: attempts }] = await Promise.all([
    sb.from("route_starts").select("user_id, route_id, started_at").in("user_id", userIds),
    sb.from("attempts").select("user_id, route_id, node_id, passed, created_at").in("user_id", userIds).limit(50000),
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
  const routeMap = new Map((routes || []).filter(r => !r.blocked).map(r => [r.id as string, r]));
  const totalByRoute = new Map<string, number>();
  for (const l of lessons || []) totalByRoute.set(l.route_id as string, (totalByRoute.get(l.route_id as string) ?? 0) + 1);

  const passedNodes = new Map<string, Set<string>>();
  const lastAct = new Map<string, string>();
  const startedAt = new Map<string, string>();
  const pairs = new Map<string, Set<string>>();
  const addPair = (u: string, r: string) => { if (!pairs.has(u)) pairs.set(u, new Set()); pairs.get(u)!.add(r); };

  for (const a of attempts || []) {
    const u = a.user_id as string, r = a.route_id as string, k = `${u}|${r}`;
    addPair(u, r);
    const created = a.created_at as string | null;
    if (created && (!lastAct.has(k) || created > lastAct.get(k)!)) lastAct.set(k, created);
    if (a.passed) { if (!passedNodes.has(k)) passedNodes.set(k, new Set()); passedNodes.get(k)!.add(a.node_id as string); }
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
        if (!route) continue;
        const k = `${uid}|${rid}`;
        const total = totalByRoute.get(rid) ?? 0;
        const completed = passedNodes.get(k)?.size ?? 0;
        const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
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

// ── Listado de usuarios (paginado + universo completo para "seleccionar todos") ─

export interface UcListFilters {
  search?: string;
  onlyInProgress?: boolean;   // modo auto: solo con curso a medias
  campaignId?: string;
  targetRouteId?: string;     // modo ruta: segmenta por esa ruta
  routeState?: "all" | RouteState;
  minPct?: number;
  maxPct?: number;
  completedWithinDays?: number;
  offset?: number;            // paginación (página de detalle)
  limit?: number;
}

export interface UcUsersResult {
  rows: UcUserRow[];          // página con progreso calculado
  allMatchedIds: string[];    // TODOS los ids del filtro (para "seleccionar todos", sin tope)
  total: number;
  stats: RouteAudienceStats | null; // solo en modo ruta objetivo
}

export async function ucListUsers(token: string, filters: UcListFilters = {}): Promise<UcUsersResult> {
  const empty: UcUsersResult = { rows: [], allMatchedIds: [], total: 0, stats: null };
  const admin = await requireAdmin(token);
  if (!admin) return empty;
  const sb = supabaseAdmin();

  const term = (filters.search || "").trim();
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.max(1, Math.min(200, filters.limit ?? DEFAULT_PAGE_SIZE));

  // 1) Universo de ids (ordenado) + stats de audiencia si hay ruta objetivo.
  let universe: string[] = [];
  let audience: RouteAudience | null = null;
  let stats: RouteAudienceStats | null = null;

  if (filters.targetRouteId) {
    audience = await computeRouteAudience(sb, filters.targetRouteId, {
      state: filters.routeState,
      minPct: filters.minPct,
      maxPct: filters.maxPct,
      completedWithinDays: filters.completedWithinDays,
    });
    stats = audience.stats;
    universe = audience.users.map(u => u.userId);
    // Búsqueda por nombre/correo dentro de la audiencia.
    if (term && universe.length) {
      const keep = new Set<string>();
      // Supabase .in tolera miles de ids; acotamos por seguridad.
      const slice = universe.slice(0, USER_UNIVERSE_CAP);
      const { data } = await sb
        .from("profiles").select("id")
        .in("id", slice)
        .or(`email.ilike.%${term}%,username.ilike.%${term}%,display_name.ilike.%${term}%`);
      for (const d of data || []) keep.add(d.id as string);
      universe = universe.filter(id => keep.has(id));
    }
  } else {
    let q = sb.from("profiles").select("id").order("created_at", { ascending: false }).limit(USER_UNIVERSE_CAP);
    if (term) q = q.or(`email.ilike.%${term}%,username.ilike.%${term}%,display_name.ilike.%${term}%`);
    const { data } = await q;
    universe = (data || []).map(d => d.id as string);
  }

  if (universe.length === 0) return { ...empty, stats };

  // 2) Página de detalle.
  const pageIds = universe.slice(offset, offset + limit);
  const [{ data: profs }, progressMap] = await Promise.all([
    sb.from("profiles").select("id, email, username, display_name, avatar_path").in("id", pageIds),
    computeUserRoutes(sb, pageIds),
  ]);
  const profById = new Map((profs || []).map(p => [p.id as string, p]));

  // Quién ya recibió esta campaña (dedupe visual).
  const sentSet = new Set<string>();
  if (filters.campaignId && pageIds.length) {
    const { data: sends } = await sb
      .from("user_campaign_sends").select("user_id")
      .eq("campaign_id", filters.campaignId).eq("status", "sent").in("user_id", pageIds);
    for (const s of sends || []) sentSet.add(s.user_id as string);
  }

  let rows: UcUserRow[] = pageIds.map(id => {
    const p = profById.get(id);
    const allRoutes = progressMap.get(id) || [];
    const inProgress = allRoutes.filter(c => c.completionPct < 100);
    const aud = audience?.byUser.get(id) || null;
    // El % de la ruta objetivo lo tomamos de la audiencia; el enlace/topic de allRoutes o lo derivamos.
    const targetCourse = filters.targetRouteId ? allRoutes.find(c => c.routeId === filters.targetRouteId) : null;
    return {
      id,
      name: resolveName(p || {}),
      email: (p?.email as string) || "",
      avatarUrl: p?.avatar_path
        ? sb.storage.from(AVATAR_BUCKET).getPublicUrl(p.avatar_path as string).data.publicUrl
        : null,
      allRoutes,
      inProgress,
      suggested: inProgress[0] ?? null,
      targetPct: aud ? aud.pct : (targetCourse ? targetCourse.completionPct : null),
      targetState: aud ? aud.state : null,
      alreadySent: sentSet.has(id),
    };
  });

  // En modo auto, el filtro "solo con curso a medias" acota la página.
  if (!filters.targetRouteId && filters.onlyInProgress) {
    rows = rows.filter(u => u.inProgress.length > 0);
  }

  return { rows, allMatchedIds: universe, total: universe.length, stats };
}

// ── Redacción con Gemini (dos flujos: ruta fija o IA elige el segmento) ────────

export interface GenerateInput {
  prompt: string;
  currentSubject?: string;
  currentBody?: string;
  targetRouteId?: string | null;
  audienceFilters?: RouteAudienceFilters;
}

export interface SuggestedSegment {
  targetRouteId: string | null;
  state: "all" | RouteState | null;
  completedWithinDays: number | null;
  minPct: number | null;
  maxPct: number | null;
}

export interface GenerateResult {
  ok: boolean;
  error?: string;
  subject?: string;
  body?: string;
  suggestedName?: string;
  suggestedSegment?: SuggestedSegment;
}

const GEMINI_PERSONA = `Eres un copywriter experto de Learn Factory, una plataforma para aprender cualquier tema con IA y gamificación. Escribes correos en español para usuarios YA REGISTRADOS.

VOZ: hablas como Mauricio Duque, fundador de Learn Factory. Cercano, humano, directo, cero corporativo. Tuteas. Frases cortas.

MERGE FIELDS disponibles (úsalos de forma natural; el sistema los reemplaza por destinatario):
- {{nombre}} → nombre del usuario
- {{curso}} → título del curso (cuando hay ruta objetivo, es esa ruta)
- {{progreso}} → su porcentaje de avance, ej. "35%"
- {{enlace}} → enlace para abrir/retomar el curso (ponlo en su propia línea)

REGLAS:
- NO incluyas firma, despedida con nombre, ni datos de contacto: la firma se añade automáticamente.
- Texto plano (sin HTML, sin markdown, sin asteriscos).
- Entre 90 y 180 palabras. Un solo llamado a la acción claro con {{enlace}}.`;

function routeContextBlock(ctx: RouteAiContext): string {
  const conceptos = ctx.conceptos.map(c => `- ${c.nombre}: ${c.definicion}`).join("\n");
  const titulos = ctx.lessonTitles.map(t => `- ${t}`).join("\n");
  return `\n\nCONTENIDO DE LA RUTA "${ctx.topic}" (úsalo para escribir contenido de VALOR real y concreto, no genérico):
Descripción: ${ctx.description || "(sin descripción)"}
Tesis global: ${ctx.tesisGlobal || "(no disponible)"}
Conceptos clave:
${conceptos || "(sin conceptos)"}
Títulos de lecciones:
${titulos || "(sin lecciones)"}${ctx.advertencias.length ? `\nAdvertencias de contexto (no las repitas como verdades): ${ctx.advertencias.join(" · ")}` : ""}`;
}

function audienceBlock(stats: RouteAudienceStats): string {
  return `\n\nAUDIENCIA (datos reales de los estudiantes de esta ruta — úsalos para escribir con tino):
- Total: ${stats.total} · En progreso: ${stats.inProgress} · Completaron: ${stats.completed} · Sin empezar: ${stats.notStarted}
- Avance promedio: ${stats.avgPct}% · Terminaron rápido (≤${DEFAULT_FAST_DAYS} días): ${stats.completedFast}`;
}

// Wrapper de la llamada a Gemini con manejo robusto de vacío/bloqueo.
async function callGemini(prompt: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta GEMINI_API_KEY en el entorno." };
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Sin maxOutputTokens: gemini-2.5-flash "piensa" y un tope bajo vaciaría el JSON.
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" },
    });
    const result = await model.generateContent(prompt);
    const finishReason = result.response.candidates?.[0]?.finishReason;
    const blockReason = result.response.promptFeedback?.blockReason;
    let text = "";
    try { text = result.response.text(); } catch { text = ""; }
    if (!text.trim()) {
      console.warn("[UserCampaigns] Gemini devolvió vacío:", { finishReason, blockReason });
      if (blockReason) return { ok: false, error: `Gemini bloqueó el contenido (${blockReason}). Cambia el enfoque del prompt.` };
      return { ok: false, error: "Gemini no devolvió texto. Reintenta o reformula el prompt." };
    }
    return { ok: true, text };
  } catch (e) {
    console.warn("[UserCampaigns] Gemini falló:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `No se pudo generar con Gemini: ${msg.slice(0, 160)}` };
  }
}

function parseJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T; }
  catch {
    try { return JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim()) as T; }
    catch { return null; }
  }
}

export async function ucGenerateWithGemini(token: string, input: GenerateInput): Promise<GenerateResult> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  if (!process.env.GEMINI_API_KEY) return { ok: false, error: "Falta GEMINI_API_KEY en el entorno." };
  const instruction = (input.prompt || "").trim();
  if (!instruction) return { ok: false, error: "Escribe qué correo quieres que redacte." };
  const sb = supabaseAdmin();

  const draft = (input.currentSubject || input.currentBody)
    ? `\n\nBORRADOR ACTUAL (mejóralo o reescríbelo según la instrucción):\nAsunto: ${input.currentSubject || "(vacío)"}\nCuerpo:\n${input.currentBody || "(vacío)"}`
    : "";

  // ── Flujo 1: ruta objetivo ya elegida → 1 llamada con contexto + audiencia ──
  if (input.targetRouteId) {
    const ctx = await buildRouteContext(sb, input.targetRouteId);
    if (!ctx) return { ok: false, error: "La ruta objetivo no existe o está fuera del aire." };
    const audience = await computeRouteAudience(sb, input.targetRouteId, input.audienceFilters || {});
    const prompt = `${GEMINI_PERSONA}${routeContextBlock(ctx)}${audienceBlock(audience.stats)}

INSTRUCCIÓN DEL ADMIN (manda sobre el tono/ángulo/contenido): ${instruction}${draft}

Devuelve EXCLUSIVAMENTE un objeto JSON válido:
{ "subject": "asunto corto y atractivo", "body": "cuerpo del correo en texto plano", "name": "nombre corto sugerido para guardar esta campaña" }`;
    const res = await callGemini(prompt);
    if (!res.ok) return { ok: false, error: res.error };
    const parsed = parseJson<{ subject?: string; body?: string; name?: string }>(res.text!);
    const subject = (parsed?.subject || "").trim();
    const body = (parsed?.body || "").trim();
    if (!subject || !body) return { ok: false, error: "Gemini no devolvió un correo completo. Reintenta." };
    return { ok: true, subject, body, suggestedName: (parsed?.name || "").trim() || undefined };
  }

  // ── Flujo 2: la IA elige el segmento (2 pasadas) ──
  const catalog = await ucListRoutes(token);
  const catalogText = catalog.slice(0, 120).map(r => `- ${r.id} :: ${r.topic} (${r.studentCount} est.)`).join("\n");
  const prompt1 = `${GEMINI_PERSONA}

CATÁLOGO DE RUTAS (id :: título):
${catalogText || "(no hay rutas)"}

El admin quiere una campaña. Interpreta su instrucción y decide:
1) Si la campaña es SOBRE una ruta específica, pon su id en "targetRouteId" (debe ser uno del catálogo); si es general, null.
2) Un segmento de audiencia sugerido con "state" ("all" | "in_progress" | "completed" | "not_started" | null), "completedWithinDays" (entero o null, para premios a quienes terminaron rápido), "minPct" y "maxPct" (0-100 o null).
3) El correo (asunto y cuerpo) y un nombre corto para guardar la campaña.

INSTRUCCIÓN DEL ADMIN: ${instruction}${draft}

Devuelve EXCLUSIVAMENTE un objeto JSON válido:
{ "targetRouteId": "<id o null>", "state": "<all|in_progress|completed|not_started|null>", "completedWithinDays": <entero o null>, "minPct": <entero o null>, "maxPct": <entero o null>, "subject": "...", "body": "...", "name": "..." }`;

  const res1 = await callGemini(prompt1);
  if (!res1.ok) return { ok: false, error: res1.error };
  const p1 = parseJson<{
    targetRouteId?: string | null; state?: string | null; completedWithinDays?: number | null;
    minPct?: number | null; maxPct?: number | null; subject?: string; body?: string; name?: string;
  }>(res1.text!);
  if (!p1) return { ok: false, error: "Gemini no devolvió un JSON válido. Reintenta." };

  const validStates = new Set(["all", "in_progress", "completed", "not_started"]);
  const catalogIds = new Set(catalog.map(r => r.id));
  const pickedRoute = p1.targetRouteId && catalogIds.has(p1.targetRouteId) ? p1.targetRouteId : null;
  const segment: SuggestedSegment = {
    targetRouteId: pickedRoute,
    state: p1.state && validStates.has(p1.state) ? (p1.state as SuggestedSegment["state"]) : null,
    completedWithinDays: typeof p1.completedWithinDays === "number" ? p1.completedWithinDays : null,
    minPct: typeof p1.minPct === "number" ? p1.minPct : null,
    maxPct: typeof p1.maxPct === "number" ? p1.maxPct : null,
  };

  let subject = (p1.subject || "").trim();
  let body = (p1.body || "").trim();

  // 2ª pasada: si eligió una ruta, reescribimos el cuerpo con su contenido real.
  if (pickedRoute) {
    const ctx = await buildRouteContext(sb, pickedRoute);
    if (ctx) {
      const audience = await computeRouteAudience(sb, pickedRoute, {
        state: segment.state || undefined,
        completedWithinDays: segment.completedWithinDays ?? undefined,
        minPct: segment.minPct ?? undefined,
        maxPct: segment.maxPct ?? undefined,
      });
      const prompt2 = `${GEMINI_PERSONA}${routeContextBlock(ctx)}${audienceBlock(audience.stats)}

INSTRUCCIÓN DEL ADMIN: ${instruction}
Reescribe el correo con CONTENIDO DE VALOR concreto de la ruta (usa sus conceptos), manteniendo la intención.

Devuelve EXCLUSIVAMENTE un objeto JSON válido:
{ "subject": "...", "body": "..." }`;
      const res2 = await callGemini(prompt2);
      if (res2.ok) {
        const p2 = parseJson<{ subject?: string; body?: string }>(res2.text!);
        if (p2?.subject?.trim() && p2?.body?.trim()) { subject = p2.subject.trim(); body = p2.body.trim(); }
      }
    }
  }

  if (!subject || !body) return { ok: false, error: "Gemini no devolvió un correo completo. Reintenta." };
  return { ok: true, subject, body, suggestedName: (p1.name || "").trim() || undefined, suggestedSegment: segment };
}

// ── Envío de UN correo (lo orquesta el panel, uno por uno, con throttle) ──────

export interface UcSendResult {
  ok: boolean;
  error?: string;
  capReached?: boolean;
}

/** Resuelve {curso,progreso,enlace} de un usuario contra una ruta objetivo. */
async function resolveTargetVars(
  sb: ReturnType<typeof supabaseAdmin>,
  routeId: string,
  userId: string
): Promise<{ curso: string; progreso: string; enlace: string } | null> {
  const { data: route } = await sb.from("routes").select("topic, blocked").eq("id", routeId).single();
  if (!route || route.blocked) return null;
  const [{ count: total }, { data: passed }] = await Promise.all([
    sb.from("lessons").select("id", { count: "exact", head: true }).eq("route_id", routeId),
    sb.from("attempts").select("node_id").eq("route_id", routeId).eq("user_id", userId).eq("passed", true).limit(2000),
  ]);
  const distinct = new Set((passed || []).map(a => a.node_id as string)).size;
  const pct = (total ?? 0) > 0 ? Math.min(100, Math.round((distinct / (total as number)) * 100)) : 0;
  return { curso: route.topic as string, progreso: `${pct}%`, enlace: `${getBaseUrl()}/route/${routeId}` };
}

export async function ucSendOne(
  token: string,
  campaignId: string,
  userId: string
): Promise<UcSendResult> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  if ((await sentTodayCount()) >= DEFAULT_DAILY_CAP) {
    return { ok: false, capReached: true, error: `Tope diario alcanzado (${DEFAULT_DAILY_CAP}).` };
  }

  const { data: campaign, error: cErr } = await sb
    .from("user_campaigns").select("subject, body, target_route_id").eq("id", campaignId).single();
  if (cErr || !campaign) return { ok: false, error: "No se encontró la campaña." };

  const { data: profile, error: pErr } = await sb
    .from("profiles").select("id, email, username, display_name").eq("id", userId).single();
  if (pErr || !profile) return { ok: false, error: "No se encontró el usuario." };
  const to = (profile.email as string || "").trim();
  if (!isValidEmail(to)) return { ok: false, error: "El usuario no tiene un correo válido." };

  const targetRouteId = (campaign.target_route_id as string) || null;
  const tplText = `${campaign.subject}\n${campaign.body}`;
  const usesCourse = /\{\{\s*(curso|enlace|progreso)\s*\}\}/.test(tplText);

  let curso = "", progreso = "", enlace = "", routeIdForLog: string | null = null;

  if (targetRouteId) {
    // Modo ruta objetivo: los merge fields se resuelven contra ESA ruta.
    const tv = await resolveTargetVars(sb, targetRouteId, userId);
    if (!tv) return { ok: false, error: "La ruta objetivo no existe o está fuera del aire." };
    curso = tv.curso; progreso = tv.progreso; enlace = tv.enlace; routeIdForLog = targetRouteId;
  } else {
    // Modo auto: curso a medias del usuario (actividad más reciente).
    const allRoutes = (await computeUserRoutes(sb, [userId])).get(userId) || [];
    const suggested = allRoutes.filter(c => c.completionPct < 100)[0] ?? null;
    if (usesCourse && !suggested) {
      return { ok: false, error: "El usuario no tiene un curso a medias para personalizar." };
    }
    curso = suggested?.topic || "";
    progreso = suggested ? `${suggested.completionPct}%` : "";
    enlace = suggested?.link || "";
    routeIdForLog = suggested?.routeId ?? null;
  }

  const vars: UserMergeVars = { nombre: resolveName(profile), curso, progreso, enlace };
  const subject = renderUserTemplate(campaign.subject as string, vars).trim();
  const bodyText = renderUserTemplate(campaign.body as string, vars);

  const sig = await getSignature();
  const html = htmlFromText(bodyText) + sig;
  const fullText = `${bodyText}\n\n${stripHtml(sig)}`;

  const result = await sendEmail({ to, subject, text: fullText, html });

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

  await sb.from("user_campaign_sends").insert({
    campaign_id: campaignId,
    user_id: userId,
    route_id: routeIdForLog,
    subject,
    status: result.ok ? "sent" : "failed",
  });

  if (!result.ok) return { ok: false, error: result.error || "No se pudo enviar." };
  return { ok: true };
}
