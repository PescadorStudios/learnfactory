// Primitivas de generación de lecciones reutilizables por los server actions
// (routeActions.ts) y por el worker durable (/api/route-jobs/worker).
// SOLO servidor: usa el service role y la API de Gemini.
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  generateLessonContent,
  generateQuizNode,
  generateBossExam,
} from "@/lib/generation";
import type { Tree, TreeNode, Sintesis, AttentionMode } from "@/lib/types";

export const AUDIO_BUCKET = "lesson-audio";
// Una lección "generating" más vieja que esto se considera huérfana (su proceso
// murió, p.ej. fin de invocación serverless): se puede reclamar y reintentar.
export const STALE_GENERATING_MS = 5 * 60 * 1000;

export function flattenNodes(tree: Tree): TreeNode[] {
  return tree.levels.flatMap(l => l.nodes);
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
