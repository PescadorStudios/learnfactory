// Primitivas de generación de lecciones reutilizables por los server actions
// (routeActions.ts) y por el worker durable (/api/route-jobs/worker).
// SOLO servidor: usa el service role y la API de Gemini.
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  generateLessonContent,
  generateQuizNode,
  generateBossExam,
  generateStudyPack,
  generateCoverImage,
  buildCoverPrompt,
} from "@/lib/generation";
import { normalizeSize } from "@/lib/routeSize";
import type { Tree, TreeNode, Sintesis, AttentionMode } from "@/lib/types";

export const AUDIO_BUCKET = "lesson-audio";
export const COVER_BUCKET = "route-covers";
// Una lección "generating" más vieja que esto se considera huérfana (su proceso
// murió, p.ej. fin de invocación serverless): se puede reclamar y reintentar.
export const STALE_GENERATING_MS = 5 * 60 * 1000;

export function flattenNodes(tree: Tree): TreeNode[] {
  return tree.levels.flatMap(l => l.nodes);
}

/** Decodifica base64 (con o sin prefijo data URL) a referencia para Gemini. */
export function toCoverReference(base64?: string | null): Array<{ mimeType: string; data: string }> {
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

/** Genera una portada con IA y la sube a Storage, guardando cover_path/cover_prompt. */
export async function generateAndStoreCover(
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

interface PreparedRoute {
  topic: string;
  tree: Tree;
  sintesis: Sintesis;
  /** Si la síntesis se acaba de generar, la tarea de portada a despachar (en after()). */
  cover?: { prompt: string; refs: Array<{ mimeType: string; data: string }> };
}

/**
 * Garantiza que la ruta tenga su síntesis maestra (árbol) y los placeholders de
 * lecciones, generándolos si aún no existen. El worker la llama ANTES de generar
 * lecciones: así la síntesis pesada corre en background (con maxDuration alto y
 * reintentos del cron) en vez de bloquear el request de createRoute. Idempotente:
 * si el árbol ya existe, solo asegura los placeholders y vuelve.
 */
export async function prepareRoute(routeId: string): Promise<{ ok: true; data: PreparedRoute } | { ok: false; error: string }> {
  const sb = supabaseAdmin();
  const { data: route } = await sb
    .from("routes")
    .select("topic, sintesis, tree, sources, size, cover_prompt, cover_reference")
    .eq("id", routeId)
    .single();
  if (!route) return { ok: false, error: "Ruta no encontrada" };

  let tree = route.tree as Tree;
  let sintesis = route.sintesis as Sintesis;
  let cover: PreparedRoute["cover"];

  const needsSynthesis = !tree?.levels || tree.levels.length === 0;
  if (needsSynthesis) {
    console.log(`[RouteGen] Síntesis maestra de la ruta ${routeId}...`);
    const pack = await generateStudyPack(route.topic, route.sources || "", normalizeSize(route.size));
    if (!pack?.tree?.levels?.length) {
      return { ok: false, error: "La síntesis no produjo un árbol válido." };
    }
    sintesis = pack.sintesis;
    tree = pack.tree;
    const description = (pack.sintesis?.tesisGlobal || "").slice(0, 280) || null;
    await sb.from("routes").update({ sintesis, tree, description }).eq("id", routeId);

    // Portada: prompt del usuario o uno base con la tesis ya disponible.
    const coverPrompt = route.cover_prompt?.trim() || buildCoverPrompt(route.topic, pack.sintesis?.tesisGlobal);
    cover = { prompt: coverPrompt, refs: toCoverReference(route.cover_reference) };
    if (route.cover_reference) {
      await sb.from("routes").update({ cover_reference: null }).eq("id", routeId);
    }
  }

  // Asegurar los placeholders de lecciones (cubre el create decoupled y un fallo
  // a mitad de la síntesis): si no hay ninguna, se insertan desde el árbol.
  const { count } = await sb.from("lessons").select("id", { count: "exact", head: true }).eq("route_id", routeId);
  if (!count) {
    const rows = flattenNodes(tree).map(node => ({
      route_id: routeId,
      node_id: node.id,
      node_type: node.type,
      title: node.title,
      concept_ids: node.conceptIds || [],
      status: node.type === "debate" ? "ready" : "pending",
    }));
    await sb.from("lessons").upsert(rows, { onConflict: "route_id,node_id" });
  }

  return { ok: true, data: { topic: route.topic, tree, sintesis, cover } };
}

/**
 * Plan de generación por nodo, calculable ANTES de generar nada:
 * - studiedConceptIds: conceptos de todos los nodos anteriores en el árbol.
 * - attentionMode: las 3 mecánicas de atención rotan en orden cíclico entre
 *   las lecciones con audio (espía → subtítulos → co-piloto), nunca dos
 *   veces seguidas la misma.
 */
export interface LessonPlanEntry {
  node: TreeNode;
  studiedConceptIds: string[];
  attentionMode: AttentionMode;
}

const ATTENTION_CYCLE: AttentionMode[] = ["spy", "subtitles", "copilot"];

export function buildLessonPlan(tree: Tree): Map<string, LessonPlanEntry> {
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
 * Genera el contenido (y audio) de UNA lección y escribe el resultado en su fila
 * de `lessons` (status ready/error). Idempotente: la fila es el placeholder del
 * resultado y Supabase Realtime empuja el cambio al cliente al completarse.
 */
export async function generateOneLesson(
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
