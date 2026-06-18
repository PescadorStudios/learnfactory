"use server";

// Server actions de datos: rutas, lecciones pregeneradas, intentos y stats.
// Toda consulta verifica el access token del usuario; el acceso a Postgres
// usa el service role (RLS bloquea la API anónima).

import { after } from "next/server";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import {
  generateStudyPack,
  generateBossExam,
  buildCoverPrompt,
  craftCoverPrompt,
  findSourcesOnline,
} from "@/lib/generation";
import {
  AUDIO_BUCKET,
  COVER_BUCKET,
  STALE_GENERATING_MS,
  flattenNodes,
  buildLessonPlan,
  generateOneLesson,
  generateAndStoreCover,
  toCoverReference,
} from "@/lib/routeGen";
import { enqueueRouteJob, kickWorker } from "@/lib/routeJobs";
import type {
  Tree,
  Sintesis,
  RouteSummary,
  RouteDetail,
  NodeState,
  LessonData,
  AttemptInput,
  SaveAttemptResult,
  LessonGenStatus,
  BossExamData,
  AttentionData,
  RouteCategory,
  DiscoveredSource,
  MicroLessonProgress,
} from "@/lib/types";
import { ROUTE_CATEGORIES, SOURCE_TYPES } from "@/lib/types";
import { explorerRank, GRADUATE_THRESHOLD } from "@/lib/reputation";
import { creditsFor, normalizeSize, type RouteSize } from "@/lib/routeSize";

// AUDIO_BUCKET, COVER_BUCKET, STALE_GENERATING_MS y los helpers de portada/síntesis
// viven en @/lib/routeGen (compartidos con el worker).
const REVIEW_AFTER_DAYS = 4;
const REVIEW_MASTERY_THRESHOLD = 80;

// ──────────────────────────────────────────────────
//  AUTH / PERFIL
// ──────────────────────────────────────────────────

/** Registra un usuario (sin verificación de email) y crea su profile con username. */
export async function registerUser(email: string, password: string, username?: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin();

  // Validar username si se provee (único)
  let cleanUsername: string | null = null;
  if (username) {
    cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      return { ok: false, error: "El usuario debe tener 3-20 caracteres: letras, números o guion bajo." };
    }
    const { data: taken } = await sb.from("profiles").select("id").eq("username", cleanUsername).maybeSingle();
    if (taken) return { ok: false, error: "Ese nombre de usuario ya está en uso." };
  }

  const { data, error } = await sb.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
  });
  if (error) {
    return { ok: false, error: error.message.includes("already") ? "Ese correo ya está registrado." : error.message };
  }
  await sb.from("profiles").upsert(
    { id: data.user.id, email: data.user.email, role: "user", username: cleanUsername, display_name: cleanUsername },
    { onConflict: "id" }
  );
  return { ok: true };
}

/** Garantiza que exista la fila de profile (para sesiones creadas fuera de registerUser). */
export async function ensureProfile(token: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };
  await supabaseAdmin().from("profiles").upsert(
    { id: user.id, email: user.email },
    { onConflict: "id", ignoreDuplicates: true }
  );
  return { ok: true };
}

// ──────────────────────────────────────────────────
//  CREAR RUTA + PREGENERACIÓN EN BACKGROUND
// ──────────────────────────────────────────────────

function cleanCategory(category?: string): RouteCategory {
  return (ROUTE_CATEGORIES.some(c => c.id === category) ? category : "otros") as RouteCategory;
}

export async function createRoute(
  token: string,
  topic: string,
  sourcesStr: string,
  visibility: "public" | "private" = "public",
  category?: string,
  cover?: { prompt?: string; reference?: string },
  size: RouteSize = "short"
): Promise<{ routeId?: string; error?: string; quotaReached?: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { error: "Sesión inválida" };

  // Guarda barata e instantánea: demasiadas fuentes. El control real de tamaño
  // (recorte al presupuesto) lo hace el worker tras extraer el texto.
  const sourceCount = (sourcesStr || "").split(",").map(s => s.trim()).filter(Boolean).length;
  if (sourceCount > 25) {
    return { error: "Demasiadas fuentes (máximo 25). Junta el material en menos archivos o crea varias rutas." };
  }

  const sb = supabaseAdmin();
  await sb.from("profiles").upsert({ id: user.id, email: user.email }, { onConflict: "id", ignoreDuplicates: true });

  // Cuota de creación: consumir es gratis, crear rutas con IA cuesta créditos.
  // route_quota = balance de créditos; lo usado = suma del costo de cada ruta.
  const routeSize = normalizeSize(size);
  const cost = creditsFor(routeSize);
  const { data: profile } = await sb.from("profiles").select("route_quota").eq("id", user.id).single();
  const quota = profile?.route_quota ?? 1;
  const { data: ownRoutes } = await sb
    .from("routes")
    .select("credits")
    .eq("owner_id", user.id);
  const creditsUsed = (ownRoutes ?? []).reduce(
    (sum, r) => sum + ((r as { credits: number | null }).credits ?? 1),
    0
  );
  if (creditsUsed + cost > quota) {
    return { error: "quota", quotaReached: true };
  }

  console.log(`[Route] Creando ruta "${topic}" (${routeSize}, ${cost} créditos) para ${user.email}...`);

  // Ruta placeholder: nace con árbol VACÍO y responde al instante. La síntesis
  // maestra (Gemini, lo lento) y las lecciones las hace el worker en background,
  // así createRoute no excede el límite del proxy ni da "error de conexión".
  // La portada se genera en el worker tras la síntesis (necesita la tesis).
  const placeholderSintesis = { tesisGlobal: "", conceptos: [], advertenciasDeContexto: [] };
  const { data: route, error } = await sb
    .from("routes")
    .insert({
      owner_id: user.id,
      topic,
      sources: sourcesStr,
      sintesis: placeholderSintesis,
      tree: { topic, levels: [] },
      status: "generating",
      visibility,
      description: null,
      category: cleanCategory(category),
      size: routeSize,
      credits: cost,
      cover_prompt: cover?.prompt?.trim() || null,
      cover_reference: cover?.reference || null,
    })
    .select("id")
    .single();

  if (error || !route) {
    console.error("[Route] Error insertando ruta:", error);
    return { error: "No se pudo guardar la ruta." };
  }

  // Encolar el job durable y despertar al worker (que sintetiza, genera y manda
  // el correo; termina solo aunque el usuario cierre la ventana; el cron de
  // Vercel es la red de seguridad).
  await enqueueRouteJob(route.id);
  after(() => kickWorker());

  console.log(`[Route] ✓ Ruta ${route.id} creada (placeholder). Síntesis y generación en background.`);
  return { routeId: route.id };
}

/** URL pública de la portada de una ruta (helper interno). */
function coverUrlFor(coverPath: string | null): string | null {
  if (!coverPath) return null;
  return supabaseAdmin().storage.from(COVER_BUCKET).getPublicUrl(coverPath).data.publicUrl;
}

// ──────────────────────────────────────────────────
//  CREACIÓN DE RUTAS EN LOTE (exclusiva, activada por el admin)
// ──────────────────────────────────────────────────

const BATCH_MAX = 20;
// Las síntesis maestras son lo pesado del arranque del lote: limitar cuántas
// corren a la vez (el TTS ya tiene su propio semáforo global en generation.ts).
const STUDYPACK_MAX_CONCURRENT = 3;
let studyPackActive = 0;
const studyPackWaiters: Array<() => void> = [];

async function acquireStudyPackSlot(): Promise<void> {
  if (studyPackActive < STUDYPACK_MAX_CONCURRENT) {
    studyPackActive++;
    return;
  }
  await new Promise<void>(resolve => studyPackWaiters.push(resolve));
  studyPackActive++;
}

function releaseStudyPackSlot(): void {
  studyPackActive--;
  const next = studyPackWaiters.shift();
  if (next) next();
}

export interface BatchRouteInput {
  topic: string;
  /** Links separados por coma (web, YouTube o archivos), igual que createRoute. */
  sources: string;
  category: string;
  visibility?: "public" | "private";
  /** Prompt de portada opcional (si no, se genera con el prompt automático). */
  coverPrompt?: string;
  /** Imagen de referencia opcional para la portada (base64, con o sin prefijo data URL). */
  coverReference?: string;
  /** Tamaño de la ruta (corta/mediana/completa). Default: "short". */
  size?: RouteSize;
}

/**
 * Agente de dirección de arte: convierte unas pocas palabras del usuario en un
 * prompt de portada de alto impacto (editable antes de crear la ruta).
 */
export async function suggestCoverPrompt(
  token: string,
  topic: string,
  idea: string,
  hasReference: boolean
): Promise<{ ok: boolean; prompt?: string; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const t = topic.trim().slice(0, 140);
  if (!t) return { ok: false, error: "Primero escribe el tema de la ruta." };
  const prompt = await craftCoverPrompt(t, idea.trim().slice(0, 300), hasReference);
  return { ok: true, prompt };
}

/**
 * Búsqueda web real de fuentes para "IA busca las mejores fuentes": acota por los
 * tipos de fuente que el usuario eligió y devuelve fuentes reales (con grounding)
 * para que apruebe cuáles entran a la ruta.
 */
export async function discoverSources(
  token: string,
  topic: string,
  sourceTypes: string[]
): Promise<{ ok: boolean; sources?: DiscoveredSource[]; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };

  const t = topic.trim().slice(0, 140);
  if (!t) return { ok: false, error: "Primero escribe el tema de la ruta." };

  const validIds = SOURCE_TYPES.map(s => s.id) as readonly string[];
  const types = (Array.isArray(sourceTypes) ? sourceTypes : []).filter(s => validIds.includes(s));

  const sources = await findSourcesOnline(t, types);
  return { ok: true, sources };
}


/**
 * Pipeline completo de UNA ruta del lote: síntesis maestra → árbol + lecciones
 * placeholder → portada → generación de lecciones en paralelo. La fila de la
 * ruta ya existe (status "generating"); aquí se va llenando.
 */
async function generateFullRoute(routeId: string, topic: string, sources: string, item: BatchRouteInput) {
  const sb = supabaseAdmin();
  try {
    await acquireStudyPackSlot();
    let pack;
    try {
      console.log(`[Batch] Síntesis de "${topic}" (ruta ${routeId})...`);
      pack = await generateStudyPack(topic, sources, normalizeSize(item.size));
    } finally {
      releaseStudyPackSlot();
    }

    const description = (pack.sintesis?.tesisGlobal || "").slice(0, 280) || null;
    await sb.from("routes").update({ sintesis: pack.sintesis, tree: pack.tree, description }).eq("id", routeId);

    const lessonRows = flattenNodes(pack.tree).map(node => ({
      route_id: routeId,
      node_id: node.id,
      node_type: node.type,
      title: node.title,
      concept_ids: node.conceptIds || [],
      status: node.type === "debate" ? "ready" : "pending",
    }));
    await sb.from("lessons").insert(lessonRows);

    // Portada: prompt del usuario (con referencia opcional) o el automático
    const references = toCoverReference(item.coverReference);
    let coverPrompt = item.coverPrompt?.trim().slice(0, 600) || buildCoverPrompt(topic, pack.sintesis?.tesisGlobal);
    if (references.length > 0) {
      coverPrompt += "\n\nUsa la imagen adjunta como referencia e intégrala de forma elegante y protagonista en la portada.";
    }
    // La portada no bloquea las lecciones: corre en paralelo dentro del mismo job
    const coverJob = generateAndStoreCover(routeId, topic, coverPrompt, references);

    // Encolar la generación de lecciones en el worker durable y despertarlo.
    await enqueueRouteJob(routeId);
    await kickWorker();
    await coverJob;
  } catch (e) {
    console.error(`[Batch] ✗ Ruta ${routeId} ("${topic}") falló:`, e);
    await sb.from("routes").update({ status: "error" }).eq("id", routeId);
  }
}

/**
 * Crea hasta 20 rutas EN PARALELO (estilo Video Factory: cada tarjeta es un
 * job). Exclusivo: requiere profiles.batch_enabled (lo activa el admin).
 * Inserta todas las filas al instante (placeholders con status "generating")
 * y despacha los pipelines en background; el cliente sigue el progreso por
 * polling de getMyRoutes.
 */
export async function createRouteBatch(
  token: string,
  items: BatchRouteInput[]
): Promise<{ ok: boolean; routeIds?: string[]; error?: string; quotaReached?: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };

  const sb = supabaseAdmin();
  const { data: profile } = await sb
    .from("profiles")
    .select("route_quota, batch_enabled")
    .eq("id", user.id)
    .single();

  if (!profile?.batch_enabled) {
    return { ok: false, error: "La creación en lote no está activada para tu cuenta. Pídesela al administrador." };
  }

  const clean = items
    .map(i => ({
      ...i,
      topic: i.topic?.trim().slice(0, 140) || "",
      sources: i.sources?.trim() || "",
      category: cleanCategory(i.category),
      visibility: i.visibility === "private" ? "private" as const : "public" as const,
    }))
    .filter(i => i.topic && i.sources);

  if (clean.length === 0) return { ok: false, error: "Cada ruta necesita un tema y al menos un link." };
  if (clean.length > BATCH_MAX) return { ok: false, error: `Máximo ${BATCH_MAX} rutas por lote.` };

  // Cuota: el lote completo debe caber en lo que queda. Igual que createRoute,
  // contamos por CRÉDITOS (cada tamaño cuesta distinto), no por número de rutas.
  const quota = profile.route_quota ?? 1;
  const { data: ownRoutes } = await sb
    .from("routes")
    .select("credits")
    .eq("owner_id", user.id);
  const creditsUsed = (ownRoutes ?? []).reduce(
    (sum, r) => sum + ((r as { credits: number | null }).credits ?? 1),
    0
  );
  const batchCost = clean.reduce((sum, i) => sum + creditsFor(normalizeSize(i.size)), 0);
  if (creditsUsed + batchCost > quota) {
    return { ok: false, error: "quota", quotaReached: true };
  }

  // Insertar todas las filas YA (placeholders): el usuario ve sus tarjetas al instante
  const placeholderSintesis = { tesisGlobal: "", conceptos: [], advertenciasDeContexto: [] };
  const { data: rows, error } = await sb
    .from("routes")
    .insert(
      clean.map(i => ({
        owner_id: user.id,
        topic: i.topic,
        sources: i.sources,
        sintesis: placeholderSintesis,
        tree: { topic: i.topic, levels: [] },
        status: "generating",
        visibility: i.visibility,
        category: i.category,
        size: normalizeSize(i.size),
        credits: creditsFor(normalizeSize(i.size)),
      }))
    )
    .select("id, topic");

  if (error || !rows?.length) {
    console.error("[Batch] Error insertando rutas:", error);
    return { ok: false, error: "No se pudieron crear las rutas." };
  }

  // Despachar TODOS los pipelines en background (el semáforo regula las síntesis)
  after(() =>
    Promise.allSettled(
      rows.map((r, idx) => generateFullRoute(r.id, clean[idx].topic, clean[idx].sources, clean[idx]))
    )
  );

  console.log(`[Batch] ⚡ Lote de ${rows.length} rutas despachado para ${user.email}.`);
  return { ok: true, routeIds: rows.map(r => r.id) };
}

// ──────────────────────────────────────────────────
//  CATEGORÍA Y ELIMINACIÓN (solo dueño)
// ──────────────────────────────────────────────────

export async function setRouteCategory(token: string, routeId: string, category: string): Promise<{ ok: boolean; category?: RouteCategory }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };
  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("owner_id").eq("id", routeId).single();
  if (!route || route.owner_id !== user.id) return { ok: false };
  const cat = cleanCategory(category);
  await sb.from("routes").update({ category: cat }).eq("id", routeId);
  return { ok: true, category: cat };
}

/** Elimina una ruta del creador: audios y portadas de Storage + la fila (cascade borra lecciones, intentos, ratings y favoritos). */
export async function deleteRoute(token: string, routeId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const sb = supabaseAdmin();

  const { data: route } = await sb.from("routes").select("owner_id, topic").eq("id", routeId).single();
  if (!route) return { ok: false, error: "Ruta no encontrada" };
  if (route.owner_id !== user.id) return { ok: false, error: "Solo el creador puede eliminar la ruta." };

  // Storage: audios de lecciones y portadas viven bajo el prefijo routeId/
  for (const bucket of [AUDIO_BUCKET, COVER_BUCKET]) {
    try {
      const { data: files } = await sb.storage.from(bucket).list(routeId, { limit: 200 });
      if (files?.length) {
        await sb.storage.from(bucket).remove(files.map(f => `${routeId}/${f.name}`));
      }
    } catch (e) {
      console.warn(`[Delete] No se pudo limpiar ${bucket}/${routeId}:`, e);
    }
  }

  const { error } = await sb.from("routes").delete().eq("id", routeId);
  if (error) return { ok: false, error: "No se pudo eliminar la ruta." };
  console.log(`[Delete] ✓ Ruta ${routeId} ("${route.topic}") eliminada por su creador.`);
  return { ok: true };
}

// buildLessonPlan y generateOneLesson viven en @/lib/routeGen (los comparte el
// worker durable /api/route-jobs/worker, que es quien genera las lecciones).

/**
 * Regenera una lección bajo demanda del CREADOR del curso, con un prompt
 * opcional que guía la regeneración (p. ej. "hazla más práctica, con
 * ejemplos de medicina"). Reemplaza el contenido y el audio existentes.
 */
export async function regenerateLesson(
  token: string,
  routeId: string,
  nodeId: string,
  guidance?: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("owner_id, topic, sintesis, tree").eq("id", routeId).single();
  if (!route) return { ok: false, error: "Ruta no encontrada" };
  if (route.owner_id !== user.id) return { ok: false, error: "Solo el creador puede regenerar lecciones." };

  const plan = buildLessonPlan(route.tree as Tree);
  const entry = plan.get(nodeId);
  if (!entry || entry.node.type === "debate") return { ok: false, error: "Esta lección no se puede regenerar." };

  await sb.from("lessons").update({ status: "pending", error: null }).eq("route_id", routeId).eq("node_id", nodeId);
  after(() =>
    generateOneLesson(
      routeId,
      route.topic,
      route.sintesis as Sintesis,
      entry.node,
      entry.studiedConceptIds,
      entry.attentionMode,
      guidance?.trim() || undefined
    )
  );
  return { ok: true };
}

/**
 * Reintenta la generación de una lección fallida y CONTINÚA la cola completa:
 * re-encola el job de la ruta (resetea sus intentos a 0 para que el worker la
 * regenere) y despierta al worker, que completa esa y todas las pendientes.
 */
export async function retryLesson(token: string, routeId: string, nodeId: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("id").eq("id", routeId).single();
  if (!route) return { ok: false };

  // attempts a 0: un reintento manual no debe chocar con el tope automático.
  await sb.from("lessons").update({ status: "pending", error: null, attempts: 0 })
    .eq("route_id", routeId).eq("node_id", nodeId);
  await enqueueRouteJob(routeId);
  after(() => kickWorker());
  return { ok: true };
}

/**
 * Reanuda la generación de una ruta entera: re-encola el job y despierta al
 * worker, que reclama las lecciones huérfanas/en error y completa las pendientes.
 * Sigue disponible como fallback manual, aunque el cron ya las completa solo.
 */
export async function resumeRoute(token: string, routeId: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("owner_id").eq("id", routeId).single();
  if (!route || route.owner_id !== user.id) return { ok: false };

  // Reintentos manuales: limpiar el tope para lecciones atascadas en error.
  await sb.from("lessons").update({ attempts: 0 })
    .eq("route_id", routeId).eq("status", "error");
  await enqueueRouteJob(routeId);
  after(() => kickWorker());
  return { ok: true };
}

/** Regenera el examen boss con preguntas nuevas (para reintentos tras fallar). */
export async function regenerateBoss(token: string, routeId: string, nodeId: string): Promise<BossExamData | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("topic, sintesis").eq("id", routeId).single();
  if (!route) return null;

  const exam = await generateBossExam(route.topic, route.sintesis as Sintesis);
  await sb.from("lessons").update({ content: exam }).eq("route_id", routeId).eq("node_id", nodeId);
  return exam;
}

// ──────────────────────────────────────────────────
//  CONSULTAS
// ──────────────────────────────────────────────────

export async function getMyRoutes(token: string): Promise<RouteSummary[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];

  const sb = supabaseAdmin();
  const { data: routes } = await sb
    .from("routes")
    .select("id, topic, status, created_at, visibility, cover_path, description, category")
    .eq("owner_id", user.id)
    .eq("blocked", false)
    .order("created_at", { ascending: false });
  if (!routes?.length) return [];

  const routeIds = routes.map(r => r.id);
  const [{ data: lessons }, { data: attempts }] = await Promise.all([
    sb.from("lessons").select("route_id, node_id, status").in("route_id", routeIds),
    sb.from("attempts").select("route_id, node_id, stars, passed").eq("user_id", user.id).in("route_id", routeIds),
  ]);

  return routes.map(r => {
    const ls = (lessons || []).filter(l => l.route_id === r.id);
    const at = (attempts || []).filter(a => a.route_id === r.id && a.passed);
    const completedNodes = new Set(at.map(a => a.node_id));
    const bestByNode = new Map<string, number>();
    for (const a of at) {
      bestByNode.set(a.node_id, Math.max(bestByNode.get(a.node_id) ?? 0, a.stars));
    }
    const bests = [...bestByNode.values()];
    return {
      id: r.id,
      topic: r.topic,
      status: r.status,
      createdAt: r.created_at,
      totalNodes: ls.length,
      readyNodes: ls.filter(l => l.status === "ready").length,
      completedNodes: completedNodes.size,
      avgStars: bests.length ? Math.round((bests.reduce((a, b) => a + b, 0) / bests.length) * 10) / 10 : null,
      visibility: (r.visibility as RouteSummary["visibility"]) || "public",
      coverUrl: coverUrlFor(r.cover_path),
      description: r.description ?? null,
      category: cleanCategory(r.category),
    };
  });
}

/** Racha: días consecutivos (terminando hoy o ayer) con al menos un intento. */
function computeStreak(dates: string[]): number {
  const days = new Set(dates.map(d => d.slice(0, 10)));
  if (days.size === 0) return 0;
  const today = new Date();
  const dayStr = (offset: number) => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
  let start = 0;
  if (!days.has(dayStr(0))) {
    if (!days.has(dayStr(1))) return 0;
    start = 1;
  }
  let streak = 0;
  for (let i = start; days.has(dayStr(i)); i++) streak++;
  return streak;
}

export async function getRoute(token: string, routeId: string): Promise<RouteDetail | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const sb = supabaseAdmin();
  const { data: route } = await sb
    .from("routes")
    .select("id, topic, status, sintesis, tree, owner_id, visibility, blocked, cover_path, description, gen_notice")
    .eq("id", routeId)
    .single();
  // Acceso: dueño siempre; cualquiera si la ruta es pública. Si está fuera del
  // aire (blocked) por el admin, no la abre nadie.
  if (!route) return null;
  if (route.blocked) return null;
  const isOwner = route.owner_id === user.id;
  if (!isOwner && route.visibility !== "public") return null;

  const [{ data: lessons }, { data: attempts }, { data: mastery }, { data: allUserAttempts }, { data: myProfile }] = await Promise.all([
    sb.from("lessons").select("node_id, status, error, generating_at").eq("route_id", routeId),
    sb.from("attempts").select("node_id, stars, passed, xp, created_at").eq("route_id", routeId).eq("user_id", user.id),
    sb.from("concept_mastery").select("concept_id, score, last_reviewed").eq("route_id", routeId).eq("user_id", user.id),
    sb.from("attempts").select("created_at").eq("user_id", user.id),
    sb.from("profiles").select("routes_completed, avg_stars").eq("id", user.id).single(),
  ]);

  const masteryMap = new Map((mastery || []).map(m => [m.concept_id, m]));
  const tree = route.tree as Tree;
  const nodes: Record<string, NodeState> = {};
  const now = Date.now();

  for (const node of flattenNodes(tree)) {
    const lesson = (lessons || []).find(l => l.node_id === node.id);
    const nodeAttempts = (attempts || []).filter(a => a.node_id === node.id);
    const passedAttempts = nodeAttempts.filter(a => a.passed);
    const bestStars = passedAttempts.length ? Math.max(...passedAttempts.map(a => a.stars)) : null;

    const conceptIds = node.conceptIds || [];
    const scores = conceptIds.map(c => masteryMap.get(c)?.score).filter((s): s is number => typeof s === "number");
    const avgMastery = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    // Repaso recomendado: completado hace > N días con maestría media < umbral
    let reviewDue = false;
    if (passedAttempts.length && (avgMastery === null || avgMastery < REVIEW_MASTERY_THRESHOLD)) {
      let lastTouched = Math.max(...nodeAttempts.map(a => new Date(a.created_at).getTime()));
      for (const c of conceptIds) {
        const m = masteryMap.get(c);
        if (m?.last_reviewed) lastTouched = Math.max(lastTouched, new Date(m.last_reviewed).getTime());
      }
      reviewDue = now - lastTouched > REVIEW_AFTER_DAYS * 86400000;
    }

    const stale =
      lesson?.status === "generating" &&
      (!lesson.generating_at || now - new Date(lesson.generating_at).getTime() > STALE_GENERATING_MS);

    nodes[node.id] = {
      status: (lesson?.status as LessonGenStatus) || "pending",
      error: lesson?.error || null,
      bestStars,
      attemptCount: nodeAttempts.length,
      mastery: avgMastery,
      reviewDue,
      stale,
    };
  }

  const xpTotal = (attempts || []).reduce((sum, a) => sum + (a.xp || 0), 0);
  const streakDays = computeStreak((allUserAttempts || []).map(r => r.created_at));

  // Reputación de explorador (para celebrar rank-ups) y % de esta ruta
  const myRank = explorerRank(myProfile?.routes_completed ?? 0, myProfile?.avg_stars ?? 0).level;
  const totalLessons = (lessons || []).length;
  const passedNodes = new Set((attempts || []).filter(a => a.passed).map(a => a.node_id)).size;
  const myCompletionPct = totalLessons > 0 ? Math.round((passedNodes / totalLessons) * 100) : 0;

  return {
    id: route.id,
    topic: route.topic,
    status: route.status,
    sintesis: route.sintesis as Sintesis,
    tree,
    nodes,
    xpTotal,
    streakDays,
    visibility: (route.visibility as RouteDetail["visibility"]) || "public",
    coverUrl: coverUrlFor(route.cover_path),
    description: route.description ?? null,
    isOwner,
    explorerRank: myRank,
    myCompletionPct,
    genNotice: (route as { gen_notice?: string | null }).gen_notice ?? null,
  };
}

export async function getLesson(token: string, routeId: string, nodeId: string): Promise<LessonData | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const sb = supabaseAdmin();
  const [{ data: route }, { data: lesson }] = await Promise.all([
    sb.from("routes").select("topic, sintesis, owner_id, visibility, blocked").eq("id", routeId).single(),
    sb.from("lessons").select("*").eq("route_id", routeId).eq("node_id", nodeId).single(),
  ]);
  // Acceso: dueño siempre; cualquiera si la ruta es pública. Bloqueada → nadie.
  if (!route || !lesson) return null;
  if (route.blocked) return null;
  if (route.owner_id !== user.id && route.visibility !== "public") return null;

  let audioUrl: string | null = null;
  if (lesson.audio_path) {
    audioUrl = sb.storage.from(AUDIO_BUCKET).getPublicUrl(lesson.audio_path).data.publicUrl;
  }

  const type = lesson.node_type as LessonData["nodeType"];
  const content = lesson.content as Record<string, unknown> | null;

  // El nuevo sistema guarda un objeto { mode: ... }; las lecciones antiguas
  // guardaban un array de preguntas flash → se tratan como "sin juego".
  const rawAttention = lesson.audio_questions;
  const attention: AttentionData | null =
    rawAttention && !Array.isArray(rawAttention) && typeof rawAttention === "object" && "mode" in rawAttention
      ? (rawAttention as AttentionData)
      : null;

  return {
    nodeId: lesson.node_id,
    nodeType: type,
    title: lesson.title,
    conceptIds: (lesson.concept_ids as string[]) || [],
    status: lesson.status as LessonGenStatus,
    error: lesson.error,
    steps: type === "theory" || type === "practice" ? ((content?.steps as LessonData["steps"]) ?? null) : null,
    quiz: type === "quiz" ? ((content as LessonData["quiz"]) ?? null) : null,
    boss: type === "boss" ? ((content as unknown as BossExamData) ?? null) : null,
    attention,
    audioUrl,
    audioDurationSeconds: lesson.audio_duration ?? null,
    topic: route.topic,
    sintesis: route.sintesis as Sintesis,
  };
}

/** Una estación jugable del túnel: la lección de audio lista de un nodo. */
export interface RouteAudioStation {
  nodeId: string;
  title: string;
  audioUrl: string; // WAV continuo público (mismo que reproduce /lesson)
  durationSeconds: number; // versiona la caché de audio
  attention: AttentionData; // spy | subtitles | copilot
}

/**
 * Estaciones jugables de una ruta para EL TÚNEL: los nodos cuya lección de audio
 * ya está lista (un WAV continuo + los cues de una de las 3 mecánicas). Mismo
 * control de acceso que getLesson (dueño siempre; pública para cualquiera;
 * bloqueada → nadie). Devuelve `null` si no hay acceso, y `stations: []` si la
 * ruta es accesible pero aún no tiene audios listos (el túnel cae entonces al
 * modo sintetizado). El orden sigue el del árbol (flattenNodes) para que el viaje
 * sea coherente con la ruta original.
 */
export async function getRouteAudioStations(
  token: string,
  routeId: string
): Promise<{ topic: string; stations: RouteAudioStation[] } | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const sb = supabaseAdmin();
  const [{ data: route }, { data: lessons }] = await Promise.all([
    sb.from("routes").select("topic, tree, owner_id, visibility, blocked").eq("id", routeId).single(),
    sb
      .from("lessons")
      .select("node_id, title, audio_path, audio_duration, audio_questions, status")
      .eq("route_id", routeId)
      .eq("status", "ready"),
  ]);
  if (!route || route.blocked) return null;
  if (route.owner_id !== user.id && route.visibility !== "public") return null;

  // Index por nodo (solo los que tienen WAV + una mecánica válida {mode:...}).
  const byNode = new Map<string, RouteAudioStation>();
  for (const l of lessons || []) {
    if (!l.audio_path) continue;
    const att = l.audio_questions;
    if (!att || Array.isArray(att) || typeof att !== "object" || !("mode" in att)) continue;
    byNode.set(l.node_id, {
      nodeId: l.node_id,
      title: l.title,
      audioUrl: sb.storage.from(AUDIO_BUCKET).getPublicUrl(l.audio_path).data.publicUrl,
      durationSeconds: (l.audio_duration as number) ?? 0,
      attention: att as AttentionData,
    });
  }

  // Orden del árbol; los nodos sin audio listo simplemente se omiten.
  const stations: RouteAudioStation[] = [];
  for (const node of flattenNodes(route.tree as Tree)) {
    const st = byNode.get(node.id);
    if (st) stations.push(st);
  }
  return { topic: route.topic, stations };
}

// ──────────────────────────────────────────────────
//  MODO PODCAST — catálogo de lecciones de audio para escucha continua
// ──────────────────────────────────────────────────

/** Una lección de audio lista para sonar en el reproductor de podcast. */
export interface PodcastLesson {
  routeId: string;
  nodeId: string;
  title: string;
  audioUrl: string; // WAV público (mismo que reproduce /lesson)
  durationSeconds: number;
  mode: AttentionData["mode"]; // spy | subtitles | copilot (solo informativo)
}

/** Rutas agrupadas con sus lecciones de audio, para el lobby del podcast. */
export interface PodcastRouteGroup {
  routeId: string;
  topic: string;
  coverUrl: string | null;
  category: RouteCategory;
  lessons: PodcastLesson[];
}

const PODCAST_PUBLIC_LIMIT = 150;

/**
 * Catálogo del modo podcast: TODA la biblioteca pública (rutas con visibilidad
 * pública y no bloqueadas, las más recientes hasta un tope) MÁS las rutas propias
 * del usuario, agrupadas por ruta y solo con las lecciones cuyo audio ya está
 * listo. El reproductor encola estos `audioUrl` y los suena uno tras otro; como
 * NO corre los juegos de atención, el Co-Piloto se reproduce sin pausas.
 */
export async function getPodcastCatalog(token: string): Promise<PodcastRouteGroup[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];
  const sb = supabaseAdmin();

  // 1) Rutas candidatas: públicas recientes (con tope) + propias del usuario.
  const ROUTE_COLS = "id, topic, cover_path, category, created_at";
  const [{ data: pub }, { data: mine }] = await Promise.all([
    sb.from("routes").select(ROUTE_COLS)
      .eq("visibility", "public").eq("blocked", false)
      .order("created_at", { ascending: false }).limit(PODCAST_PUBLIC_LIMIT),
    sb.from("routes").select(ROUTE_COLS)
      .eq("owner_id", user.id).eq("blocked", false),
  ]);

  const routeMeta = new Map<string, { topic: string; cover_path: string | null; category?: string }>();
  for (const r of [...(pub || []), ...(mine || [])]) {
    if (!routeMeta.has(r.id)) routeMeta.set(r.id, { topic: r.topic, cover_path: r.cover_path, category: r.category });
  }
  const routeIds = [...routeMeta.keys()];
  if (routeIds.length === 0) return [];

  // 2) Lecciones de audio listas de esas rutas (una sola consulta).
  const { data: lessons } = await sb
    .from("lessons")
    .select("route_id, node_id, title, audio_path, audio_duration, audio_questions, status")
    .in("route_id", routeIds)
    .eq("status", "ready");

  const byRoute = new Map<string, PodcastLesson[]>();
  for (const l of lessons || []) {
    if (!l.audio_path) continue;
    const att = l.audio_questions;
    if (!att || Array.isArray(att) || typeof att !== "object" || !("mode" in att)) continue;
    const arr = byRoute.get(l.route_id) ?? [];
    arr.push({
      routeId: l.route_id,
      nodeId: l.node_id,
      title: l.title,
      audioUrl: sb.storage.from(AUDIO_BUCKET).getPublicUrl(l.audio_path).data.publicUrl,
      durationSeconds: (l.audio_duration as number) ?? 0,
      mode: (att as AttentionData).mode,
    });
    byRoute.set(l.route_id, arr);
  }

  // 3) Ordenar las lecciones de cada ruta según el árbol (solo para las rutas que
  //    sí tienen audio, para no traer árboles de más).
  const routesWithAudio = [...byRoute.keys()];
  if (routesWithAudio.length) {
    const { data: trees } = await sb.from("routes").select("id, tree").in("id", routesWithAudio);
    for (const t of trees || []) {
      const lessonsOfRoute = byRoute.get(t.id);
      if (!lessonsOfRoute) continue;
      const order = new Map(flattenNodes(t.tree as Tree).map((n, i) => [n.id, i]));
      lessonsOfRoute.sort((a, b) => (order.get(a.nodeId) ?? 999) - (order.get(b.nodeId) ?? 999));
    }
  }

  // 4) Construir grupos (solo rutas con al menos una lección de audio), ordenados
  //    por tema para una navegación estable.
  const groups: PodcastRouteGroup[] = [];
  for (const routeId of routeIds) {
    const lessonsOfRoute = byRoute.get(routeId);
    if (!lessonsOfRoute || lessonsOfRoute.length === 0) continue;
    const meta = routeMeta.get(routeId)!;
    groups.push({
      routeId,
      topic: meta.topic,
      coverUrl: coverUrlFor(meta.cover_path),
      category: cleanCategory(meta.category),
      lessons: lessonsOfRoute,
    });
  }
  groups.sort((a, b) => a.topic.localeCompare(b.topic));
  return groups;
}

// ──────────────────────────────────────────────────
//  INTENTOS Y MAESTRÍA
// ──────────────────────────────────────────────────

export async function saveAttempt(
  token: string,
  routeId: string,
  nodeId: string,
  input: AttemptInput
): Promise<SaveAttemptResult> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, xpGained: 0, newBest: false, bestStars: 0 };

  const sb = supabaseAdmin();

  const stars = Math.max(0, Math.min(5, input.stars));

  // ¿Es el primer intento del usuario en TODA la ruta? (para contar estudiantes)
  const { count: priorAttemptsInRoute } = await sb
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("route_id", routeId);
  const isFirstInRoute = (priorAttemptsInRoute ?? 0) === 0;

  // Mejor score previo
  const { data: prev } = await sb
    .from("attempts")
    .select("stars")
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .eq("node_id", nodeId)
    .eq("passed", true);
  const prevBest = prev?.length ? Math.max(...prev.map(p => p.stars)) : null;

  await sb.from("attempts").insert({
    user_id: user.id,
    route_id: routeId,
    node_id: nodeId,
    stars,
    passed: input.passed,
    xp: Math.max(0, Math.round(input.xp)),
    detail: input.detail,
  });

  // La lección se completó: descartar cualquier borrador de "reanudar".
  await sb
    .from("lesson_progress")
    .delete()
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .eq("node_id", nodeId);

  // Nuevo estudiante de la ruta: recomputar student_count desde la fuente (sin drift)
  if (isFirstInRoute) {
    const { data: distinctRows } = await sb
      .from("attempts")
      .select("user_id")
      .eq("route_id", routeId);
    const studentCount = new Set((distinctRows || []).map(r => r.user_id)).size;
    await sb.from("routes").update({ student_count: studentCount }).eq("id", routeId);
  }

  // Upsert de maestría por concepto
  for (const u of input.masteryUpdates) {
    if (!u.conceptId) continue;
    const { data: existing } = await sb
      .from("concept_mastery")
      .select("score, attempts")
      .eq("user_id", user.id)
      .eq("route_id", routeId)
      .eq("concept_id", u.conceptId)
      .maybeSingle();

    const newScore = Math.max(0, Math.min(100, (existing?.score ?? 0) + u.delta));
    await sb.from("concept_mastery").upsert({
      user_id: user.id,
      route_id: routeId,
      concept_id: u.conceptId,
      score: newScore,
      attempts: (existing?.attempts ?? 0) + 1,
      last_reviewed: new Date().toISOString(),
    }, { onConflict: "user_id,route_id,concept_id" });
  }

  // ── Reputación de dos vías ──
  // Solo cuando el usuario aprueba un nodo que NUNCA había aprobado (prevBest
  // null): es el único momento en que puede cambiar su % de la ruta.
  let explorerRankUp: number | undefined;
  if (input.passed && prevBest === null) {
    try {
      explorerRankUp = await updateReputation(user.id, routeId);
    } catch (e) {
      console.warn("[Reputation] No se pudo actualizar la reputación:", e);
    }
  }

  const newBest = input.passed && (prevBest === null || stars > prevBest);
  return {
    ok: true,
    xpGained: Math.max(0, Math.round(input.xp)),
    newBest,
    bestStars: Math.max(prevBest ?? 0, input.passed ? stars : 0),
    explorerRankUp,
  };
}

// ──────────────────────────────────────────────────
//  REANUDAR MICROLECCIÓN (borrador de progreso parcial)
// ──────────────────────────────────────────────────

/** Guarda/actualiza el borrador de progreso de una microlección. */
export async function saveLessonProgress(
  token: string,
  routeId: string,
  nodeId: string,
  state: MicroLessonProgress
): Promise<void> {
  const user = await getUserFromToken(token);
  if (!user) return;
  await supabaseAdmin()
    .from("lesson_progress")
    .upsert(
      {
        user_id: user.id,
        route_id: routeId,
        node_id: nodeId,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,route_id,node_id" }
    );
}

/** Devuelve el borrador guardado para reanudar, o null si no hay. */
export async function getLessonProgress(
  token: string,
  routeId: string,
  nodeId: string
): Promise<MicroLessonProgress | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const { data } = await supabaseAdmin()
    .from("lesson_progress")
    .select("state")
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .eq("node_id", nodeId)
    .maybeSingle();
  return (data?.state as MicroLessonProgress) ?? null;
}

/** Borra el borrador (al elegir "empezar de nuevo"). */
export async function clearLessonProgress(
  token: string,
  routeId: string,
  nodeId: string
): Promise<void> {
  const user = await getUserFromToken(token);
  if (!user) return;
  await supabaseAdmin()
    .from("lesson_progress")
    .delete()
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .eq("node_id", nodeId);
}

/**
 * Recalcula la reputación tras aprobar un nodo nuevo:
 * - Si el estudiante cruzó el 80% de la ruta → graduate_count de la ruta y
 *   graduates del creador (estudiantes DISTINTOS graduados en sus rutas).
 * - Siempre: routes_completed y avg_stars del estudiante (desde la fuente).
 * Devuelve el nuevo nivel de explorador si subió de rango.
 */
async function updateReputation(userId: string, routeId: string): Promise<number | undefined> {
  const sb = supabaseAdmin();

  // Rango ANTES (con los contadores almacenados)
  const { data: profileBefore } = await sb
    .from("profiles")
    .select("routes_completed, avg_stars")
    .eq("id", userId)
    .single();
  const rankBefore = explorerRank(profileBefore?.routes_completed ?? 0, profileBefore?.avg_stars ?? 0).level;

  // ¿El estudiante acaba de cruzar el 80% de ESTA ruta?
  const [{ count: totalLessons }, { data: myPassed }] = await Promise.all([
    sb.from("lessons").select("id", { count: "exact", head: true }).eq("route_id", routeId),
    sb.from("attempts").select("node_id").eq("route_id", routeId).eq("user_id", userId).eq("passed", true),
  ]);
  const total = totalLessons ?? 0;
  const done = new Set((myPassed || []).map(r => r.node_id)).size;
  // El nodo recién aprobado es el que pudo cruzar el umbral
  const justGraduated = total > 0 && done / total >= GRADUATE_THRESHOLD && (done - 1) / total < GRADUATE_THRESHOLD;

  if (justGraduated) {
    // graduate_count de la ruta: recomputar desde la fuente (sin drift)
    const { data: routeRow } = await sb.from("routes").select("owner_id").eq("id", routeId).single();
    const { data: allPassed } = await sb
      .from("attempts")
      .select("user_id, node_id")
      .eq("route_id", routeId)
      .eq("passed", true);
    const perUser = new Map<string, Set<string>>();
    for (const a of allPassed || []) {
      if (!perUser.has(a.user_id)) perUser.set(a.user_id, new Set());
      perUser.get(a.user_id)!.add(a.node_id);
    }
    let graduateCount = 0;
    for (const nodes of perUser.values()) {
      if (nodes.size / total >= GRADUATE_THRESHOLD) graduateCount++;
    }
    await sb.from("routes").update({ graduate_count: graduateCount }).eq("id", routeId);

    // graduates del creador: +1 solo si este estudiante no había graduado
    // ya OTRA ruta suya (cuenta estudiantes distintos; el backfill corrige drift)
    if (routeRow?.owner_id && routeRow.owner_id !== userId) {
      const { data: ownerRoutes } = await sb.from("routes").select("id").eq("owner_id", routeRow.owner_id).neq("id", routeId);
      const otherIds = (ownerRoutes || []).map(r => r.id);
      let alreadyCounted = false;
      if (otherIds.length > 0) {
        const [{ data: otherPassed }, { data: otherLessons }] = await Promise.all([
          sb.from("attempts").select("route_id, node_id").eq("user_id", userId).eq("passed", true).in("route_id", otherIds),
          sb.from("lessons").select("route_id").in("route_id", otherIds),
        ]);
        const totals = new Map<string, number>();
        for (const l of otherLessons || []) totals.set(l.route_id, (totals.get(l.route_id) ?? 0) + 1);
        const doneByRoute = new Map<string, Set<string>>();
        for (const a of otherPassed || []) {
          if (!doneByRoute.has(a.route_id)) doneByRoute.set(a.route_id, new Set());
          doneByRoute.get(a.route_id)!.add(a.node_id);
        }
        for (const [rid, nodes] of doneByRoute) {
          const t = totals.get(rid) ?? 0;
          if (t > 0 && nodes.size / t >= GRADUATE_THRESHOLD) { alreadyCounted = true; break; }
        }
      }
      if (!alreadyCounted) {
        const { data: ownerProfile } = await sb.from("profiles").select("graduates").eq("id", routeRow.owner_id).single();
        await sb.from("profiles").update({ graduates: (ownerProfile?.graduates ?? 0) + 1 }).eq("id", routeRow.owner_id);
        console.log(`[Reputation] 🎓 Nuevo graduado para ${routeRow.owner_id} (ruta ${routeId}).`);
      }
    }
  }

  // Reputación de explorador: recomputar desde la fuente (solo sus intentos)
  const { data: allMine } = await sb
    .from("attempts")
    .select("route_id, node_id, stars")
    .eq("user_id", userId)
    .eq("passed", true);
  const bestByNode = new Map<string, number>();
  const doneByRoute = new Map<string, Set<string>>();
  for (const a of allMine || []) {
    const key = `${a.route_id}/${a.node_id}`;
    bestByNode.set(key, Math.max(bestByNode.get(key) ?? 0, a.stars));
    if (!doneByRoute.has(a.route_id)) doneByRoute.set(a.route_id, new Set());
    doneByRoute.get(a.route_id)!.add(a.node_id);
  }
  const bests = [...bestByNode.values()];
  const avgStars = bests.length ? bests.reduce((a, b) => a + b, 0) / bests.length : 0;

  const touchedIds = [...doneByRoute.keys()];
  let routesCompleted = 0;
  if (touchedIds.length > 0) {
    const { data: lessonRows } = await sb.from("lessons").select("route_id").in("route_id", touchedIds);
    const totals = new Map<string, number>();
    for (const l of lessonRows || []) totals.set(l.route_id, (totals.get(l.route_id) ?? 0) + 1);
    for (const [rid, nodes] of doneByRoute) {
      const t = totals.get(rid) ?? 0;
      if (t > 0 && nodes.size / t >= GRADUATE_THRESHOLD) routesCompleted++;
    }
  }

  await sb.from("profiles").update({
    routes_completed: routesCompleted,
    avg_stars: Math.round(avgStars * 100) / 100,
  }).eq("id", userId);

  const rankAfter = explorerRank(routesCompleted, avgStars).level;
  if (rankAfter > rankBefore) {
    console.log(`[Reputation] ⬆️ ${userId} sube a rango de explorador ${rankAfter}.`);
    return rankAfter;
  }
  return undefined;
}
