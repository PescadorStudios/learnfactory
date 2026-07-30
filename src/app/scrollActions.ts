"use server";

// Server actions del Modo Scroll: generación de los cortos de una ruta
// (descuento de créditos + encolado del job) y consulta de su progreso.
// Toda consulta verifica el access token; el acceso a Postgres usa el service role.

import { after } from "next/server";
import { headers } from "next/headers";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { isRetoParticipant } from "@/lib/retoAccess";
import { enqueueScrollJob, kickScrollWorker } from "@/lib/scrollJobs";
import { AUDIO_BUCKET, COVER_BUCKET, flattenNodes } from "@/lib/routeGen";
import { rankFeed, type RankCandidate, type UserSignal } from "@/lib/feedRanker";
import type { VideosEstado, LessonTimeline, Tree, GateState } from "@/lib/types";
import { consumeStudyUnit } from "@/lib/sessionGate";
import { CORTO_MIN_PCT } from "@/lib/sessionBudget";

export interface GenerarVideosResult {
  ok: boolean;
  error?: string;
  quotaReached?: boolean;
  cost?: number;
}

/**
 * Genera los cortos del Modo Scroll de una ruta (uno por lección con audio).
 * SOLO el creador. Es GRATIS (valor agregado): no consume créditos. La
 * generación corre OFFLINE en cola (el scroll nunca la dispara).
 */
export async function generarVideosRuta(
  token: string,
  routeId: string,
  opts?: { regenerar?: boolean }
): Promise<GenerarVideosResult> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const regenerar = Boolean(opts?.regenerar);

  const sb = supabaseAdmin();
  const { data: route } = await sb
    .from("routes")
    .select("owner_id, videos_estado")
    .eq("id", routeId)
    .single();
  if (!route) return { ok: false, error: "Ruta no encontrada." };
  if (route.owner_id !== user.id) return { ok: false, error: "Solo el creador puede generar los videos." };

  const estado = (route.videos_estado as VideosEstado) ?? "sin_videos";
  // En modo normal, si ya está 'listo' no hay nada que hacer. En modo REGENERAR
  // (botón "Regenerar videos") rehacemos TODO, incluso si estaba 'listo'.
  if (!regenerar && estado === "listo") return { ok: true, cost: 0 };
  // 'generando' NO retorna: re-dispara el worker (útil si el kick previo se perdió).

  // Solo hay cortos si hay lecciones con audio listo.
  const { count: audioLessons } = await sb
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("route_id", routeId)
    .eq("status", "ready")
    .not("audio_path", "is", null);
  if (!audioLessons) {
    return { ok: false, error: "Esta ruta aún no tiene lecciones con audio listas." };
  }

  if (regenerar) {
    // Rehacer TODO: también los 'ready' vuelven a 'pending' (con la última versión
    // del Director) y se reinician los intentos.
    await sb
      .from("lessons")
      .update({ timeline_status: "pending", timeline_attempts: 0, timeline_error: null })
      .eq("route_id", routeId)
      .eq("status", "ready")
      .not("audio_path", "is", null);
  } else {
    // Reintento: solo los timelines NO terminados (los 'ready' se conservan).
    await sb
      .from("lessons")
      .update({ timeline_status: "pending", timeline_error: null })
      .eq("route_id", routeId)
      .in("timeline_status", ["error", "generating"]);
  }

  await sb.from("routes").update({ videos_estado: "generando" }).eq("id", routeId);

  await enqueueScrollJob(routeId);
  // Origin del deployment actual (para que el kick llegue a ESTE deploy, no a
  // producción vía NEXT_PUBLIC_SITE_URL — clave en previews sin cron).
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : undefined;
  after(() => kickScrollWorker(origin));

  console.log(`[Scroll] ✓ Videos encolados para ruta ${routeId} (gratis).`);
  return { ok: true, cost: 0 };
}

/**
 * Integra (o quita) los cortos en el estudio normal de la lección ("ruta
 * completa"). SOLO el creador. Es un flag instantáneo: como los timelines ya
 * existen, encender migra al toque. Para integrar, los videos deben estar listos.
 */
export async function integrarCortos(
  token: string,
  routeId: string,
  integrar: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("owner_id, videos_estado").eq("id", routeId).single();
  if (!route) return { ok: false, error: "Ruta no encontrada." };
  if (route.owner_id !== user.id) return { ok: false, error: "Solo el creador puede integrar los cortos." };
  if (integrar && route.videos_estado !== "listo") {
    return { ok: false, error: "Primero genera los videos de la ruta." };
  }

  await sb.from("routes").update({ cortos_integrados: integrar }).eq("id", routeId);
  return { ok: true };
}

export interface ScrollJobStatus {
  estado: VideosEstado;
  total: number;
  completed: number;
}

/** Progreso de la generación de cortos de una ruta (para la barra de "generando"). */
export async function getScrollJobStatus(token: string, routeId: string): Promise<ScrollJobStatus | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("owner_id, videos_estado").eq("id", routeId).single();
  if (!route || route.owner_id !== user.id) return null;

  const { data: job } = await sb
    .from("scroll_jobs")
    .select("total, completed")
    .eq("route_id", routeId)
    .maybeSingle();

  return {
    estado: (route.videos_estado as VideosEstado) ?? "sin_videos",
    total: job?.total ?? 0,
    completed: job?.completed ?? 0,
  };
}

// ──────────────────────────────────────────────────
//  FEEDS — cortos listos para el reproductor vertical
// ──────────────────────────────────────────────────

/** Un corto listo para el feed: timeline declarativo + audio + datos de la ruta. */
export interface ScrollCorto {
  routeId: string;
  nodeId: string;
  title: string;
  topic: string;
  timeline: LessonTimeline;
  audioUrl: string;
  durationSeconds: number;
  coverUrl: string | null;
}

function audioUrlFor(audioPath: string | null): string {
  if (!audioPath) return "";
  return supabaseAdmin().storage.from(AUDIO_BUCKET).getPublicUrl(audioPath).data.publicUrl;
}
function coverUrlFor(coverPath: string | null): string | null {
  if (!coverPath) return null;
  return supabaseAdmin().storage.from(COVER_BUCKET).getPublicUrl(coverPath).data.publicUrl;
}

interface LessonCortoRow {
  node_id: string;
  title: string;
  timeline_json: LessonTimeline | null;
  audio_path: string | null;
  audio_duration: number | null;
}

function toCorto(routeId: string, topic: string, coverUrl: string | null, l: LessonCortoRow): ScrollCorto | null {
  const timeline = l.timeline_json;
  if (!timeline || !Array.isArray(timeline.cues) || timeline.cues.length === 0) return null;
  const audioUrl = timeline.audio_url || audioUrlFor(l.audio_path);
  if (!audioUrl) return null;
  return {
    routeId,
    nodeId: l.node_id,
    title: l.title,
    topic,
    timeline,
    audioUrl,
    durationSeconds: l.audio_duration ?? Math.round((timeline.duracion_ms || 0) / 1000),
    coverUrl,
  };
}

/**
 * Mini-feed de UNA ruta: sus cortos listos, en el orden de las lecciones del
 * árbol. Mismo control de acceso que getLesson (dueño siempre; pública para
 * cualquiera; bloqueada → nadie). `token` puede ser null (visitante anónimo de
 * una ruta pública).
 */
export async function getRouteScrollFeed(
  token: string | null,
  routeId: string
): Promise<{ topic: string; cortos: ScrollCorto[] } | null> {
  const user = token ? await getUserFromToken(token) : null;
  const sb = supabaseAdmin();

  const [{ data: route }, { data: lessons }] = await Promise.all([
    sb.from("routes").select("topic, tree, owner_id, visibility, blocked, cover_path").eq("id", routeId).single(),
    sb
      .from("lessons")
      .select("node_id, title, timeline_json, audio_path, audio_duration")
      .eq("route_id", routeId)
      .eq("timeline_status", "ready"),
  ]);
  if (!route || route.blocked) return null;
  if (
    route.owner_id !== user?.id &&
    route.visibility !== "public" &&
    !(user && (await isRetoParticipant(sb, user.id, routeId)))
  ) {
    return null;
  }

  const cover = coverUrlFor(route.cover_path);
  const byNode = new Map<string, ScrollCorto>();
  for (const l of (lessons || []) as LessonCortoRow[]) {
    const corto = toCorto(routeId, route.topic, cover, l);
    if (corto) byNode.set(l.node_id, corto);
  }

  // Orden del árbol; los nodos sin corto listo se omiten.
  const cortos: ScrollCorto[] = [];
  for (const node of flattenNodes(route.tree as Tree)) {
    const c = byNode.get(node.id);
    if (c) cortos.push(c);
  }
  return { topic: route.topic, cortos };
}

/**
 * Feed GLOBAL: pool de cortos de rutas públicas con videos listos, ORDENADO por
 * el feedRanker (afinidad + exploración + repaso espaciado), penalizando cortos
 * de baja calidad global. Hereda visibilidad: un corto es público solo si su ruta
 * lo es. El ranker decide solo el ORDEN; el contenido del corto no cambia.
 */
export interface ScrollFeedFilters {
  /** Intereses: solo estas categorías. */
  categories?: string[];
  /** Rutas específicas: solo estos ids de ruta. */
  routeIds?: string[];
  /** Aleatorio con exclusiones: descarta estas categorías. */
  excludeCategories?: string[];
  /** Aleatorio con exclusiones: descarta estas rutas. */
  excludeRouteIds?: string[];
  limit?: number;
}

export async function getGlobalScrollFeed(
  token: string | null,
  opts?: ScrollFeedFilters
): Promise<ScrollCorto[]> {
  const sb = supabaseAdmin();
  const limit = Math.min(Math.max(opts?.limit ?? 60, 1), 120);
  const user = token ? await getUserFromToken(token) : null;

  // 1) Rutas públicas con videos listos (con filtros de inclusión).
  let routeQ = sb
    .from("routes")
    .select("id, topic, cover_path, category")
    .eq("visibility", "public")
    .eq("blocked", false)
    .eq("videos_estado", "listo");
  if (opts?.categories?.length) routeQ = routeQ.in("category", opts.categories);
  if (opts?.routeIds?.length) routeQ = routeQ.in("id", opts.routeIds);
  const { data: routesRaw } = await routeQ.limit(120);
  if (!routesRaw || routesRaw.length === 0) return [];

  // Exclusiones (aleatorio): se aplican en memoria.
  const exclCats = new Set(opts?.excludeCategories ?? []);
  const exclRoutes = new Set(opts?.excludeRouteIds ?? []);
  const routes = routesRaw.filter(
    r => !exclRoutes.has(r.id) && !exclCats.has((r.category as string) || "otros")
  );
  if (routes.length === 0) return [];

  const routeIds = routes.map(r => r.id);
  const rmeta = new Map(
    routes.map(r => [r.id, { topic: r.topic as string, cover: coverUrlFor(r.cover_path), category: (r.category as string) || "otros" }])
  );

  // 2) Cortos listos de esas rutas → candidatos.
  const { data: lessons } = await sb
    .from("lessons")
    .select("route_id, node_id, title, timeline_json, audio_path, audio_duration, concept_ids")
    .in("route_id", routeIds)
    .eq("timeline_status", "ready");

  const cortoByKey = new Map<string, ScrollCorto>();
  const candidates: RankCandidate[] = [];
  for (const l of (lessons || []) as (LessonCortoRow & { route_id: string; concept_ids: string[] | null })[]) {
    const m = rmeta.get(l.route_id);
    if (!m) continue;
    const corto = toCorto(l.route_id, m.topic, m.cover, l);
    if (!corto) continue;
    cortoByKey.set(`${l.route_id}:${l.node_id}`, corto);
    candidates.push({
      routeId: l.route_id,
      nodeId: l.node_id,
      topic: m.topic,
      category: m.category,
      conceptIds: (l.concept_ids as string[]) || [],
      globalAvgPct: 50, // se refina abajo con la calidad histórica
    });
  }
  if (candidates.length === 0) return [];

  // 3) Calidad global por corto: % de visionado promedio (acotado).
  const { data: qualityRows } = await sb
    .from("corto_evento")
    .select("route_id, leccion_node_id, pct_visto")
    .in("route_id", routeIds)
    .limit(5000);
  if (qualityRows && qualityRows.length) {
    const agg = new Map<string, { sum: number; n: number }>();
    for (const q of qualityRows) {
      const k = `${q.route_id}:${q.leccion_node_id}`;
      const a = agg.get(k) ?? { sum: 0, n: 0 };
      a.sum += q.pct_visto ?? 0;
      a.n += 1;
      agg.set(k, a);
    }
    for (const c of candidates) {
      const a = agg.get(`${c.routeId}:${c.nodeId}`);
      if (a && a.n > 0) c.globalAvgPct = a.sum / a.n;
    }
  }

  // 4) Historial del usuario → señales (afinidad + repaso).
  let history: UserSignal[] = [];
  if (user) {
    const { data: events } = await sb
      .from("corto_evento")
      .select("route_id, leccion_node_id, pct_visto, liked, guardado, abrir_ruta, ts")
      .eq("usuario_id", user.id)
      .order("ts", { ascending: false })
      .limit(500);
    if (events && events.length) {
      const histRouteIds = [...new Set(events.map(e => e.route_id))];
      const histCat = new Map<string, string>();
      rmeta.forEach((v, k) => histCat.set(k, v.category));
      const missing = histRouteIds.filter(id => !histCat.has(id));
      if (missing.length) {
        const { data: hr } = await sb.from("routes").select("id, category").in("id", missing);
        for (const r of hr || []) histCat.set(r.id, (r.category as string) || "otros");
      }
      const { data: hl } = await sb.from("lessons").select("route_id, node_id, concept_ids").in("route_id", histRouteIds);
      const histConcepts = new Map<string, string[]>();
      for (const l of hl || []) histConcepts.set(`${l.route_id}:${l.node_id}`, (l.concept_ids as string[]) || []);
      history = events.map(e => ({
        routeId: e.route_id,
        nodeId: e.leccion_node_id,
        category: histCat.get(e.route_id) ?? "otros",
        conceptIds: histConcepts.get(`${e.route_id}:${e.leccion_node_id}`) ?? [],
        pctVisto: e.pct_visto ?? 0,
        liked: Boolean(e.liked),
        guardado: Boolean(e.guardado),
        abrirRuta: Boolean(e.abrir_ruta),
        ts: new Date(e.ts).getTime(),
      }));
    }
  }

  // 5) Rankear y mapear de vuelta a ScrollCorto.
  const ranked = rankFeed({ candidates, history, limit });
  const out: ScrollCorto[] = [];
  for (const r of ranked) {
    const c = cortoByKey.get(`${r.routeId}:${r.nodeId}`);
    if (c) out.push(c);
  }
  return out.length > 0 ? out : [...cortoByKey.values()].slice(0, limit);
}

export interface CortoEventoInput {
  routeId: string;
  nodeId: string;
  pctVisto?: number;
  liked?: boolean;
  guardado?: boolean;
  abrirRuta?: boolean;
}

/** Registra un evento de engagement de un corto (alimenta el ranker y el repaso). */
export async function registrarCortoEvento(
  token: string,
  ev: CortoEventoInput
): Promise<{ ok: boolean; gate?: GateState }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  const pct = Math.max(0, Math.min(100, Math.round(ev.pctVisto ?? 0)));
  const sb = supabaseAdmin();

  await sb.from("corto_evento").insert({
    usuario_id: user.id,
    route_id: ev.routeId,
    leccion_node_id: ev.nodeId,
    pct_visto: pct,
    liked: Boolean(ev.liked),
    guardado: Boolean(ev.guardado),
    abrir_ruta: Boolean(ev.abrirRuta),
  });

  // Muro de sesiones: SOLO cuenta como unidad si de verdad se vio el corto. Esta
  // misma acción se dispara al dar like, guardar o abrir la ruta, así que sin el
  // umbral un doble-tap quemaría la bolsa de la sesión.
  let gate: GateState | undefined;
  if (pct >= CORTO_MIN_PCT) {
    try {
      gate = await consumeStudyUnit(sb, user.id, "corto", `${ev.routeId}:${ev.nodeId}`, ev.routeId);
    } catch (e) {
      console.warn("[sessionGate] no se pudo cobrar la unidad del corto:", e);
    }
  }
  return { ok: true, gate };
}

// ──────────────────────────────────────────────────
//  FUENTES — para configurar la experiencia del feed (lobby)
// ──────────────────────────────────────────────────

export interface ScrollSourceRoute {
  routeId: string;
  topic: string;
  category: string;
  coverUrl: string | null;
}

export interface ScrollSources {
  /** Rutas (públicas o propias) con cortos listos, para elegir/excluir. */
  routes: ScrollSourceRoute[];
  /** Categorías presentes en esas rutas (para los chips de intereses). */
  categories: string[];
}

/**
 * Catálogo de fuentes para el lobby del Modo Scroll: las rutas que YA tienen
 * cortos listos y son visibles para el usuario (públicas + las propias), con su
 * categoría y portada. Alimenta los 3 modos: intereses, rutas específicas y
 * aleatorio (con exclusiones).
 */
export async function getScrollSources(token: string | null): Promise<ScrollSources> {
  const user = token ? await getUserFromToken(token) : null;
  const sb = supabaseAdmin();

  // Públicas con videos listos…
  const orFilter = user
    ? `visibility.eq.public,owner_id.eq.${user.id}` // …y además las propias del usuario
    : `visibility.eq.public`;
  const { data: routes } = await sb
    .from("routes")
    .select("id, topic, cover_path, category, videos_estado, blocked, visibility, owner_id")
    .eq("videos_estado", "listo")
    .eq("blocked", false)
    .or(orFilter)
    .limit(200);

  const list: ScrollSourceRoute[] = (routes || []).map(r => ({
    routeId: r.id as string,
    topic: r.topic as string,
    category: (r.category as string) || "otros",
    coverUrl: coverUrlFor(r.cover_path as string | null),
  }));
  list.sort((a, b) => a.topic.localeCompare(b.topic));

  const categories = [...new Set(list.map(r => r.category))].sort();
  return { routes: list, categories };
}
