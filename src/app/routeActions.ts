"use server";

// Server actions de datos: rutas, lecciones pregeneradas, intentos y stats.
// Toda consulta verifica el access token del usuario; el acceso a Postgres
// usa el service role (RLS bloquea la API anónima).

import { after } from "next/server";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import {
  generateStudyPack,
  generateLessonContent,
  generateQuizNode,
  generateBossExam,
  generateCoverImage,
  buildCoverPrompt,
} from "@/lib/generation";
import type {
  Tree,
  TreeNode,
  Sintesis,
  RouteSummary,
  RouteDetail,
  NodeState,
  LessonData,
  AttemptInput,
  SaveAttemptResult,
  LessonGenStatus,
  BossExamData,
  AttentionMode,
  AttentionData,
  RouteCategory,
} from "@/lib/types";
import { ROUTE_CATEGORIES } from "@/lib/types";

const AUDIO_BUCKET = "lesson-audio";
const COVER_BUCKET = "route-covers";
const REVIEW_AFTER_DAYS = 4;
const REVIEW_MASTERY_THRESHOLD = 80;
// Una lección "generating" más vieja que esto se considera huérfana (su proceso
// murió, p.ej. reinicio del server): se puede reclamar y reintentar.
const STALE_GENERATING_MS = 5 * 60 * 1000;

// Evita que dos loops de generación corran a la vez sobre la misma ruta en este
// proceso (createRoute + resumeRoute, o varios resumes seguidos).
const activeRouteGen = new Set<string>();

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

function flattenNodes(tree: Tree): TreeNode[] {
  return tree.levels.flatMap(l => l.nodes);
}

function cleanCategory(category?: string): RouteCategory {
  return (ROUTE_CATEGORIES.some(c => c.id === category) ? category : "otros") as RouteCategory;
}

export async function createRoute(
  token: string,
  topic: string,
  sourcesStr: string,
  visibility: "public" | "private" = "public",
  category?: string
): Promise<{ routeId?: string; error?: string; quotaReached?: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { error: "Sesión inválida" };

  const sb = supabaseAdmin();
  await sb.from("profiles").upsert({ id: user.id, email: user.email }, { onConflict: "id", ignoreDuplicates: true });

  // Cuota de creación: consumir es gratis, crear rutas con IA cuenta contra el plan.
  const { data: profile } = await sb.from("profiles").select("route_quota").eq("id", user.id).single();
  const quota = profile?.route_quota ?? 1;
  const { count: routesUsed } = await sb
    .from("routes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);
  if ((routesUsed ?? 0) >= quota) {
    return { error: "quota", quotaReached: true };
  }

  console.log(`[Route] Creando ruta "${topic}" para ${user.email}...`);
  const pack = await generateStudyPack(topic, sourcesStr);

  const description = (pack.sintesis?.tesisGlobal || "").slice(0, 280) || null;

  const { data: route, error } = await sb
    .from("routes")
    .insert({
      owner_id: user.id,
      topic,
      sources: sourcesStr,
      sintesis: pack.sintesis,
      tree: pack.tree,
      status: "generating",
      visibility,
      description,
      category: cleanCategory(category),
    })
    .select("id")
    .single();

  if (error || !route) {
    console.error("[Route] Error insertando ruta:", error);
    return { error: "No se pudo guardar la ruta." };
  }

  const lessonRows = flattenNodes(pack.tree).map(node => ({
    route_id: route.id,
    node_id: node.id,
    node_type: node.type,
    title: node.title,
    concept_ids: node.conceptIds || [],
    // Los debates son conversacionales (se generan en vivo): nacen listos
    status: node.type === "debate" ? "ready" : "pending",
  }));
  await sb.from("lessons").insert(lessonRows);

  // Pregenerar todo en segundo plano después de responder
  after(() => generateRouteLessons(route.id));
  // Generar portada con IA en background (no bloquea la respuesta)
  after(() => generateAndStoreCover(route.id, topic, buildCoverPrompt(topic, pack.sintesis?.tesisGlobal)));

  console.log(`[Route] ✓ Ruta ${route.id} creada con ${lessonRows.length} lecciones. Generación en background iniciada.`);
  return { routeId: route.id };
}

/** Genera una portada con IA y la sube a Storage, guardando cover_path/cover_prompt. */
async function generateAndStoreCover(
  routeId: string,
  topic: string,
  prompt: string,
  references: Array<{ mimeType: string; data: string }> = []
) {
  const sb = supabaseAdmin();
  try {
    const img = await generateCoverImage(prompt, references);
    if (!img) {
      console.warn(`[Cover] Ruta ${routeId}: sin portada (generación falló).`);
      return;
    }
    const coverPath = `${routeId}/cover.png`;
    const { error } = await sb.storage.from(COVER_BUCKET).upload(coverPath, img, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) {
      console.error(`[Cover] Error subiendo portada de ${routeId}:`, error.message);
      return;
    }
    await sb.from("routes").update({ cover_path: coverPath, cover_prompt: prompt }).eq("id", routeId);
    console.log(`[Cover] ✓ Portada de ${routeId} lista.`);
  } catch (e) {
    console.error(`[Cover] Error generando portada de ${routeId}:`, e);
  }
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
}

/** Decodifica base64 (con o sin prefijo data URL) a referencia para Gemini. */
function toCoverReference(base64?: string): Array<{ mimeType: string; data: string }> {
  if (!base64) return [];
  let contentType = "image/png";
  let data = base64;
  const m = base64.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
  if (m) {
    contentType = m[1];
    data = m[2];
  }
  if (!data) return [];
  return [{ mimeType: contentType, data }];
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
      pack = await generateStudyPack(topic, sources);
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

    await generateRouteLessons(routeId);
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

  // Cuota: el lote completo debe caber en lo que queda
  const quota = profile.route_quota ?? 1;
  const { count: routesUsed } = await sb
    .from("routes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);
  if ((routesUsed ?? 0) + clean.length > quota) {
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

/**
 * Plan de generación por nodo, calculable ANTES de generar nada:
 * - studiedConceptIds: conceptos de todos los nodos anteriores en el árbol.
 * - attentionMode: las 3 mecánicas de atención rotan en orden cíclico entre
 *   las lecciones con audio (espía → subtítulos → co-piloto), nunca dos
 *   veces seguidas la misma.
 */
interface LessonPlanEntry {
  node: TreeNode;
  studiedConceptIds: string[];
  attentionMode: AttentionMode;
}

const ATTENTION_CYCLE: AttentionMode[] = ["spy", "subtitles", "copilot"];

function buildLessonPlan(tree: Tree): Map<string, LessonPlanEntry> {
  const plan = new Map<string, LessonPlanEntry>();
  const studied: string[] = [];
  let audioLessonIndex = 0;

  for (const node of flattenNodes(tree)) {
    let attentionMode: AttentionMode = "spy";
    if (node.type === "theory" || node.type === "practice") {
      attentionMode = ATTENTION_CYCLE[audioLessonIndex % ATTENTION_CYCLE.length];
      audioLessonIndex++;
    }
    plan.set(node.id, { node, studiedConceptIds: [...studied], attentionMode });
    for (const c of node.conceptIds || []) {
      if (!studied.includes(c)) studied.push(c);
    }
  }
  return plan;
}

/**
 * Generación EN PARALELO (estilo lote): los prompts de todas las lecciones se
 * preparan de antemano (buildLessonPlan) y se despachan todos a la vez. Cada
 * fila de `lessons` es el placeholder de su resultado: al completarse, la fila
 * se actualiza y Supabase Realtime (websockets) empuja el cambio al cliente.
 * El TTS lleva un semáforo interno para respetar rate limits.
 */
async function generateRouteLessons(routeId: string) {
  if (activeRouteGen.has(routeId)) {
    console.log(`[RouteGen] Ruta ${routeId} ya tiene un lote activo; no se relanza.`);
    return;
  }
  activeRouteGen.add(routeId);

  const sb = supabaseAdmin();
  try {
    const { data: route } = await sb.from("routes").select("topic, sintesis, tree").eq("id", routeId).single();
    if (!route) return;

    const tree = route.tree as Tree;
    const sintesis = route.sintesis as Sintesis;
    const plan = buildLessonPlan(tree);

    await sb.from("routes").update({ status: "generating" }).eq("id", routeId);

    // Reclamar lecciones huérfanas (generating viejas) y reintentar las que
    // están en error: vuelven a "pending" para que el lote las regenere.
    const staleCutoff = new Date(Date.now() - STALE_GENERATING_MS).toISOString();
    await sb.from("lessons").update({ status: "pending", error: null })
      .eq("route_id", routeId).eq("status", "error").neq("node_type", "debate");
    await sb.from("lessons").update({ status: "pending", error: null })
      .eq("route_id", routeId).eq("status", "generating").lt("generating_at", staleCutoff);

    const { data: rows } = await sb.from("lessons").select("node_id, status").eq("route_id", routeId);
    const statusByNode = new Map((rows || []).map(r => [r.node_id, r.status]));

    const tasks = [...plan.values()].filter(
      p => p.node.type !== "debate" && statusByNode.get(p.node.id) === "pending"
    );

    if (tasks.length > 0) {
      console.log(`[RouteGen] ⚡ Despachando ${tasks.length} lecciones EN PARALELO (ruta ${routeId})...`);
      await Promise.allSettled(
        tasks.map(p => generateOneLesson(routeId, route.topic, sintesis, p.node, p.studiedConceptIds, p.attentionMode))
      );
    }

    await sb.from("routes").update({ status: "ready" }).eq("id", routeId);
    console.log(`[RouteGen] ✓ Ruta ${routeId} completamente generada.`);
  } catch (e) {
    console.error(`[RouteGen] Error fatal en ruta ${routeId}:`, e);
    await sb.from("routes").update({ status: "ready" }).eq("id", routeId); // las lecciones en error se reintentan individualmente
  } finally {
    activeRouteGen.delete(routeId);
  }
}

async function generateOneLesson(
  routeId: string,
  topic: string,
  sintesis: Sintesis,
  node: TreeNode,
  studiedConceptIds: string[],
  attentionMode: AttentionMode,
  guidance?: string
) {
  const sb = supabaseAdmin();
  const focal = node.conceptIds || [];

  await sb.from("lessons")
    .update({ status: "generating", error: null, generating_at: new Date().toISOString() })
    .eq("route_id", routeId).eq("node_id", node.id);
  console.log(`[RouteGen] Generando ${node.type} "${node.title}" (${node.id}, atención: ${attentionMode})...`);

  try {
    if (node.type === "theory" || node.type === "practice") {
      const content = await generateLessonContent(
        topic, node.title, node.type, sintesis, focal, studiedConceptIds, attentionMode, guidance
      );

      let audioPath: string | null = null;
      if (content.wav && content.attention) {
        audioPath = `${routeId}/${node.id}.wav`;
        let uploaded = false;
        for (let i = 1; i <= 3 && !uploaded; i++) {
          const { error: upErr } = await sb.storage
            .from(AUDIO_BUCKET)
            .upload(audioPath, content.wav, { contentType: "audio/wav", upsert: true });
          if (!upErr) {
            uploaded = true;
          } else {
            console.error(`[RouteGen] Error subiendo audio de ${node.id} (intento ${i}/3):`, upErr.message);
            if (i < 3) await new Promise(r => setTimeout(r, 3000));
          }
        }
        if (!uploaded) {
          // El audio es parte central de la experiencia: marcar error para que el usuario reintente
          throw new Error("No se pudo subir el audio a Storage tras 3 intentos.");
        }
      }

      await sb.from("lessons").update({
        content: { steps: content.steps },
        audio_questions: audioPath ? content.attention : null,
        audio_duration: audioPath ? content.durationSeconds : null,
        audio_path: audioPath,
        status: "ready",
      }).eq("route_id", routeId).eq("node_id", node.id);
    } else if (node.type === "quiz") {
      const reviewIds = studiedConceptIds.filter(c => !focal.includes(c));
      const quiz = await generateQuizNode(topic, sintesis, focal, reviewIds, guidance);
      await sb.from("lessons").update({ content: quiz, status: "ready" }).eq("route_id", routeId).eq("node_id", node.id);
    } else if (node.type === "boss") {
      const exam = await generateBossExam(topic, sintesis, guidance);
      await sb.from("lessons").update({ content: exam, status: "ready" }).eq("route_id", routeId).eq("node_id", node.id);
    }

    console.log(`[RouteGen] ✓ ${node.id} lista`);
  } catch (e) {
    console.error(`[RouteGen] ✗ Error en ${node.id}:`, e);
    await sb.from("lessons").update({
      status: "error",
      error: e instanceof Error ? e.message : "Error desconocido",
    }).eq("route_id", routeId).eq("node_id", node.id);
  }
}

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
 * relanza el loop de la ruta, que regenera esa lección y todas las que sigan
 * pendientes (así un reintento nunca deja el resto de la cola huérfana).
 */
export async function retryLesson(token: string, routeId: string, nodeId: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("id").eq("id", routeId).single();
  if (!route) return { ok: false };

  await sb.from("lessons").update({ status: "pending", error: null }).eq("route_id", routeId).eq("node_id", nodeId);
  after(() => generateRouteLessons(routeId));
  return { ok: true };
}

/**
 * Reanuda la generación de una ruta entera: relanza el loop, que reclama las
 * lecciones huérfanas/en error y completa las pendientes. Útil si el proceso de
 * background murió (reinicio del server) y la cola se cortó.
 */
export async function resumeRoute(token: string, routeId: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("owner_id").eq("id", routeId).single();
  if (!route || route.owner_id !== user.id) return { ok: false };

  after(() => generateRouteLessons(routeId));
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
    .select("id, topic, status, sintesis, tree, owner_id, visibility, cover_path, description")
    .eq("id", routeId)
    .single();
  // Acceso: dueño siempre; cualquiera si la ruta es pública.
  if (!route) return null;
  const isOwner = route.owner_id === user.id;
  if (!isOwner && route.visibility !== "public") return null;

  const [{ data: lessons }, { data: attempts }, { data: mastery }, { data: allUserAttempts }] = await Promise.all([
    sb.from("lessons").select("node_id, status, error, generating_at").eq("route_id", routeId),
    sb.from("attempts").select("node_id, stars, passed, xp, created_at").eq("route_id", routeId).eq("user_id", user.id),
    sb.from("concept_mastery").select("concept_id, score, last_reviewed").eq("route_id", routeId).eq("user_id", user.id),
    sb.from("attempts").select("created_at").eq("user_id", user.id),
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
  };
}

export async function getLesson(token: string, routeId: string, nodeId: string): Promise<LessonData | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const sb = supabaseAdmin();
  const [{ data: route }, { data: lesson }] = await Promise.all([
    sb.from("routes").select("topic, sintesis, owner_id, visibility").eq("id", routeId).single(),
    sb.from("lessons").select("*").eq("route_id", routeId).eq("node_id", nodeId).single(),
  ]);
  // Acceso: dueño siempre; cualquiera si la ruta es pública.
  if (!route || !lesson) return null;
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

  const newBest = input.passed && (prevBest === null || stars > prevBest);
  return {
    ok: true,
    xpGained: Math.max(0, Math.round(input.xp)),
    newBest,
    bestStars: Math.max(prevBest ?? 0, input.passed ? stars : 0),
  };
}
