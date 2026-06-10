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
} from "@/lib/types";

const AUDIO_BUCKET = "lesson-audio";
const REVIEW_AFTER_DAYS = 4;
const REVIEW_MASTERY_THRESHOLD = 80;

// ──────────────────────────────────────────────────
//  AUTH / PERFIL
// ──────────────────────────────────────────────────

/** Registra un usuario (sin verificación de email) y crea su profile. */
export async function registerUser(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
  });
  if (error) {
    return { ok: false, error: error.message.includes("already") ? "Ese correo ya está registrado." : error.message };
  }
  await sb.from("profiles").upsert(
    { id: data.user.id, email: data.user.email, role: "user" },
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

export async function createRoute(
  token: string,
  topic: string,
  sourcesStr: string
): Promise<{ routeId?: string; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { error: "Sesión inválida" };

  const sb = supabaseAdmin();
  await sb.from("profiles").upsert({ id: user.id, email: user.email }, { onConflict: "id", ignoreDuplicates: true });

  console.log(`[Route] Creando ruta "${topic}" para ${user.email}...`);
  const pack = await generateStudyPack(topic, sourcesStr);

  const { data: route, error } = await sb
    .from("routes")
    .insert({
      owner_id: user.id,
      topic,
      sources: sourcesStr,
      sintesis: pack.sintesis,
      tree: pack.tree,
      status: "generating",
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

  console.log(`[Route] ✓ Ruta ${route.id} creada con ${lessonRows.length} lecciones. Generación en background iniciada.`);
  return { routeId: route.id };
}

/** Loop secuencial: genera contenido + audio de cada lección y lo persiste. */
async function generateRouteLessons(routeId: string) {
  const sb = supabaseAdmin();
  try {
    const { data: route } = await sb.from("routes").select("topic, sintesis, tree").eq("id", routeId).single();
    if (!route) return;

    const tree = route.tree as Tree;
    const sintesis = route.sintesis as Sintesis;
    const nodes = flattenNodes(tree);

    const studiedSoFar: string[] = [];

    for (const node of nodes) {
      const focal = node.conceptIds || [];

      if (node.type !== "debate") {
        const { data: lessonRow } = await sb
          .from("lessons")
          .select("id, status")
          .eq("route_id", routeId)
          .eq("node_id", node.id)
          .single();

        if (lessonRow && lessonRow.status === "pending") {
          await generateOneLesson(routeId, route.topic, sintesis, node, [...studiedSoFar]);
        }
      }

      for (const c of focal) {
        if (!studiedSoFar.includes(c)) studiedSoFar.push(c);
      }
    }

    await sb.from("routes").update({ status: "ready" }).eq("id", routeId);
    console.log(`[RouteGen] ✓ Ruta ${routeId} completamente generada.`);
  } catch (e) {
    console.error(`[RouteGen] Error fatal en ruta ${routeId}:`, e);
    await sb.from("routes").update({ status: "ready" }).eq("id", routeId); // las lecciones en error se reintentan individualmente
  }
}

async function generateOneLesson(
  routeId: string,
  topic: string,
  sintesis: Sintesis,
  node: TreeNode,
  studiedConceptIds: string[]
) {
  const sb = supabaseAdmin();
  const focal = node.conceptIds || [];

  await sb.from("lessons").update({ status: "generating", error: null }).eq("route_id", routeId).eq("node_id", node.id);
  console.log(`[RouteGen] Generando ${node.type} "${node.title}" (${node.id})...`);

  try {
    if (node.type === "theory" || node.type === "practice") {
      const content = await generateLessonContent(topic, node.title, node.type, sintesis, focal, studiedConceptIds);

      let audioPath: string | null = null;
      if (content.wav && content.audioIntro) {
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
        audio_questions: audioPath ? content.audioIntro?.questions : null,
        audio_duration: audioPath ? content.audioIntro?.durationSeconds : null,
        audio_path: audioPath,
        status: "ready",
      }).eq("route_id", routeId).eq("node_id", node.id);
    } else if (node.type === "quiz") {
      const reviewIds = studiedConceptIds.filter(c => !focal.includes(c));
      const quiz = await generateQuizNode(topic, sintesis, focal, reviewIds);
      await sb.from("lessons").update({ content: quiz, status: "ready" }).eq("route_id", routeId).eq("node_id", node.id);
    } else if (node.type === "boss") {
      const exam = await generateBossExam(topic, sintesis);
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

/** Reintenta la generación de una lección fallida (en background; el cliente hace polling). */
export async function retryLesson(token: string, routeId: string, nodeId: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("topic, sintesis, tree").eq("id", routeId).single();
  if (!route) return { ok: false };

  const tree = route.tree as Tree;
  const nodes = flattenNodes(tree);
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return { ok: false };

  // Conceptos estudiados = los de todos los nodos anteriores en el árbol
  const studied: string[] = [];
  for (const n of nodes) {
    if (n.id === nodeId) break;
    for (const c of n.conceptIds || []) if (!studied.includes(c)) studied.push(c);
  }

  await sb.from("lessons").update({ status: "pending", error: null }).eq("route_id", routeId).eq("node_id", nodeId);
  after(() => generateOneLesson(routeId, route.topic, route.sintesis as Sintesis, node, studied));
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
    .select("id, topic, status, created_at")
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
    .select("id, topic, status, sintesis, tree, owner_id")
    .eq("id", routeId)
    .single();
  if (!route || route.owner_id !== user.id) return null;

  const [{ data: lessons }, { data: attempts }, { data: mastery }, { data: allUserAttempts }] = await Promise.all([
    sb.from("lessons").select("node_id, status, error").eq("route_id", routeId),
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

    nodes[node.id] = {
      status: (lesson?.status as LessonGenStatus) || "pending",
      error: lesson?.error || null,
      bestStars,
      attemptCount: nodeAttempts.length,
      mastery: avgMastery,
      reviewDue,
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
  };
}

export async function getLesson(token: string, routeId: string, nodeId: string): Promise<LessonData | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const sb = supabaseAdmin();
  const [{ data: route }, { data: lesson }] = await Promise.all([
    sb.from("routes").select("topic, sintesis, owner_id").eq("id", routeId).single(),
    sb.from("lessons").select("*").eq("route_id", routeId).eq("node_id", nodeId).single(),
  ]);
  if (!route || route.owner_id !== user.id || !lesson) return null;

  let audioUrl: string | null = null;
  if (lesson.audio_path) {
    audioUrl = sb.storage.from(AUDIO_BUCKET).getPublicUrl(lesson.audio_path).data.publicUrl;
  }

  const type = lesson.node_type as LessonData["nodeType"];
  const content = lesson.content as Record<string, unknown> | null;

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
    audioIntro:
      lesson.audio_questions && lesson.audio_duration
        ? { durationSeconds: lesson.audio_duration, questions: lesson.audio_questions }
        : null,
    audioUrl,
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
