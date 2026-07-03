"use server";

// ============================================================================
// Academia de Retos Verificados — server actions.
// ----------------------------------------------------------------------------
// El creador crea reto + ruta PRIVADA en un solo flujo, configura premios
// ordenados y cupos gratis; los participantes entran pagando (Bold) o con un
// código, y el leaderboard ordena por finalización verificada. Todo pasa por
// el service role (RLS bloquea la API anónima) y verifica el token de usuario.
// ============================================================================

import crypto from "crypto";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { craftCoverPrompt, generateCoverImage } from "@/lib/generation";
import { COVER_BUCKET } from "@/lib/routeGen";
import { createRoute } from "./routeActions";
import {
  isVerifiedComplete,
  effectiveEstado,
  validateCupoRedemption,
  cupoCodeFromBytes,
} from "@/lib/retoLogic";
import {
  finalizeRetoIfDueCore,
  loadRetoLessons,
  fulfillRetoOrder as fulfillRetoOrderCore,
} from "@/lib/retoFulfillment";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Reto,
  RetoCupo,
  RetoDashboardData,
  RetoEstado,
  RetoLeaderboardEntry,
  RetoMoneda,
  RetoParticipando,
  RetoPremio,
  RetoPublicData,
  MyRetoProgress,
  PremioTipo,
  WalletMovimiento,
  WalletResumen,
  DatosBancarios,
} from "@/lib/types";
import type { RouteSize } from "@/lib/routeSize";

const AVATAR_BUCKET = "avatars";
const MAX_CUPOS = 10;

// ──────────────────────────────────────────────────
//  Helpers internos
// ──────────────────────────────────────────────────

function publicUrl(sb: SupabaseClient, bucket: string, path: string | null): string | null {
  if (!path) return null;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

interface RetoDbRow {
  id: string;
  creador_id: string;
  ruta_id: string;
  titulo: string;
  descripcion: string | null;
  imagen_path: string | null;
  precio_entrada: number;
  moneda: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado: RetoEstado;
  reglas: string | null;
  cupos_gratis_totales: number;
  cupos_gratis_usados: number;
  created_at: string;
}

const RETO_COLS =
  "id, creador_id, ruta_id, titulo, descripcion, imagen_path, precio_entrada, moneda, fecha_inicio, fecha_fin, estado, reglas, cupos_gratis_totales, cupos_gratis_usados, created_at";

function estadoEfectivoDe(r: RetoDbRow): RetoEstado {
  return effectiveEstado({ estado: r.estado, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin });
}

async function loadPremios(sb: SupabaseClient, retoId: string): Promise<RetoPremio[]> {
  const { data } = await sb
    .from("reto_premios")
    .select("id, posicion, titulo, descripcion, tipo")
    .eq("reto_id", retoId)
    .order("posicion");
  return (data || []).map(p => ({
    id: p.id as string,
    posicion: p.posicion as number,
    titulo: p.titulo as string,
    descripcion: (p.descripcion as string) ?? null,
    tipo: (p.tipo as PremioTipo) ?? "otro",
  }));
}

/** Reto del creador (verifica propiedad). null si no existe o no es suyo. */
async function loadOwnReto(sb: SupabaseClient, userId: string, retoId: string): Promise<RetoDbRow | null> {
  const { data } = await sb.from("retos").select(RETO_COLS).eq("id", retoId).maybeSingle();
  if (!data || (data as RetoDbRow).creador_id !== userId) return null;
  return data as RetoDbRow;
}

async function toReto(sb: SupabaseClient, r: RetoDbRow): Promise<Reto> {
  const [premios, { data: ruta }] = await Promise.all([
    loadPremios(sb, r.id),
    sb.from("routes").select("status, cover_path").eq("id", r.ruta_id).maybeSingle(),
  ]);
  return {
    id: r.id,
    rutaId: r.ruta_id,
    titulo: r.titulo,
    descripcion: r.descripcion,
    imagenUrl:
      publicUrl(sb, COVER_BUCKET, r.imagen_path) ?? publicUrl(sb, COVER_BUCKET, ruta?.cover_path ?? null),
    precioEntrada: r.precio_entrada,
    moneda: (r.moneda as RetoMoneda) || "COP",
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    estado: r.estado,
    estadoEfectivo: estadoEfectivoDe(r),
    reglas: r.reglas,
    cuposGratisTotales: r.cupos_gratis_totales,
    cuposGratisUsados: r.cupos_gratis_usados,
    premios,
    createdAt: r.created_at,
    rutaStatus: (ruta?.status as string) ?? "generating",
  };
}

/**
 * Leaderboard del reto: % verificado por participante, ganadores marcados.
 * Una sola pasada: lecciones de la ruta + todos los intentos aprobados,
 * agrupados por usuario, evaluados con la misma lógica del hook.
 */
async function buildLeaderboard(
  sb: SupabaseClient,
  reto: RetoDbRow,
  opts: { includeVia: boolean }
): Promise<RetoLeaderboardEntry[]> {
  const [{ data: parts }, lessons, { data: attempts }, premios] = await Promise.all([
    sb
      .from("reto_participantes")
      .select("user_id, via, alias, anonimo, inscrito_at, finalizacion_verificada_at, atencion_score, premio_posicion")
      .eq("reto_id", reto.id),
    loadRetoLessons(sb, reto.ruta_id),
    sb
      .from("attempts")
      .select("user_id, node_id, detail")
      .eq("route_id", reto.ruta_id)
      .eq("passed", true),
    loadPremios(sb, reto.id),
  ]);
  if (!parts?.length) return [];

  const byUser = new Map<string, Array<{ nodeId: string; passed: boolean; attention: { correct: number; total: number } | null }>>();
  for (const a of attempts || []) {
    const uid = a.user_id as string;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push({
      nodeId: a.node_id as string,
      passed: true,
      attention: (a.detail as { attention?: { correct: number; total: number } } | null)?.attention ?? null,
    });
  }

  const { data: profs } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_path")
    .in("id", parts.map(p => p.user_id));
  const profDe = new Map((profs || []).map(p => [p.id as string, p]));
  const premioDe = new Map(premios.map(p => [p.posicion, p.titulo]));

  const entries = parts.map(p => {
    const prof = profDe.get(p.user_id as string);
    const result = isVerifiedComplete(lessons, byUser.get(p.user_id as string) ?? []);
    const anonimo = Boolean(p.anonimo);
    const nombre = anonimo
      ? "Explorador anónimo"
      : (p.alias as string) || (prof?.display_name as string) || (prof?.username as string) || "Explorador";
    const entry: RetoLeaderboardEntry = {
      nombre,
      avatarUrl: anonimo ? null : publicUrl(sb, AVATAR_BUCKET, (prof?.avatar_path as string) ?? null),
      anonimo,
      completionPct: p.finalizacion_verificada_at ? 100 : result.completionPct,
      finalizadoAt: (p.finalizacion_verificada_at as string) ?? null,
      premioPosicion: (p.premio_posicion as number) ?? null,
      premioTitulo: p.premio_posicion != null ? (premioDe.get(p.premio_posicion as number) ?? null) : null,
      atencionScore: p.atencion_score != null ? Number(p.atencion_score) : null,
    };
    if (opts.includeVia) entry.via = p.via as RetoLeaderboardEntry["via"];
    return entry;
  });

  // Orden: ganadores por posición de premio; luego finalizados por timestamp;
  // luego por % de avance verificado.
  return entries.sort((a, b) => {
    if (a.premioPosicion != null || b.premioPosicion != null) {
      if (a.premioPosicion == null) return 1;
      if (b.premioPosicion == null) return -1;
      return a.premioPosicion - b.premioPosicion;
    }
    if (a.finalizadoAt || b.finalizadoAt) {
      if (!a.finalizadoAt) return 1;
      if (!b.finalizadoAt) return -1;
      return Date.parse(a.finalizadoAt) - Date.parse(b.finalizadoAt);
    }
    return b.completionPct - a.completionPct;
  });
}

// ──────────────────────────────────────────────────
//  CREADOR: crear / editar / publicar
// ──────────────────────────────────────────────────

export interface CreateRetoInput {
  titulo: string;
  descripcion?: string;
  reglas?: string;
  precioEntrada: number;
  moneda: RetoMoneda;
  fechaInicio?: string | null;
  fechaFin?: string | null;
  /** Ruta a generar junto al reto. */
  topic: string;
  sources: string;
  size?: RouteSize;
  category?: string;
}

/**
 * Crea el reto Y su ruta privada en un solo flujo. La ruta consume la cuota
 * normal de creación y se genera en background (worker existente); el reto
 * nace en borrador para que el creador configure premios, cupos e imagen.
 */
export async function createReto(
  token: string,
  input: CreateRetoInput
): Promise<{ retoId?: string; rutaId?: string; error?: string; quotaReached?: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { error: "Sesión inválida" };

  const titulo = (input.titulo || "").trim().slice(0, 140);
  if (!titulo) return { error: "El reto necesita un título." };
  const precio = Math.max(0, Math.round(input.precioEntrada || 0));
  const moneda: RetoMoneda = input.moneda === "USD" ? "USD" : "COP";

  // 1) La ruta privada (pipeline de generación intacto: worker + créditos).
  const routeRes = await createRoute(token, input.topic, input.sources, "private", input.category, undefined, input.size ?? "short");
  if (!routeRes.routeId) {
    return { error: routeRes.error || "No se pudo crear la ruta del reto.", quotaReached: routeRes.quotaReached };
  }

  // 2) El reto en borrador.
  const sb = supabaseAdmin();
  const { data: reto, error } = await sb
    .from("retos")
    .insert({
      creador_id: user.id,
      ruta_id: routeRes.routeId,
      titulo,
      descripcion: input.descripcion?.trim() || null,
      reglas: input.reglas?.trim() || null,
      precio_entrada: precio,
      moneda,
      fecha_inicio: input.fechaInicio || null,
      fecha_fin: input.fechaFin || null,
      estado: "borrador",
    })
    .select("id")
    .single();

  if (error || !reto) {
    console.error("[Reto] error insertando reto:", error?.message);
    return { error: "La ruta se creó pero el reto no se pudo guardar. Intenta de nuevo desde Mis Retos." };
  }
  console.log(`[Reto] ✓ Reto ${reto.id} creado (borrador) con ruta ${routeRes.routeId}.`);
  return { retoId: reto.id as string, rutaId: routeRes.routeId };
}

export interface UpdateRetoInput {
  titulo?: string;
  descripcion?: string | null;
  reglas?: string | null;
  precioEntrada?: number;
  moneda?: RetoMoneda;
  fechaInicio?: string | null;
  fechaFin?: string | null;
}

/** Edita el reto. El precio/moneda quedan bloqueados cuando ya hay inscritos. */
export async function updateReto(
  token: string,
  retoId: string,
  patch: UpdateRetoInput
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return { ok: false, error: "Reto no encontrado." };
  if (reto.estado === "finalizado") return { ok: false, error: "El reto ya finalizó." };

  const update: Record<string, unknown> = {};
  if (patch.titulo !== undefined) {
    const t = patch.titulo.trim().slice(0, 140);
    if (!t) return { ok: false, error: "El título no puede quedar vacío." };
    update.titulo = t;
  }
  if (patch.descripcion !== undefined) update.descripcion = patch.descripcion?.trim() || null;
  if (patch.reglas !== undefined) update.reglas = patch.reglas?.trim() || null;
  if (patch.fechaInicio !== undefined) update.fecha_inicio = patch.fechaInicio || null;
  if (patch.fechaFin !== undefined) update.fecha_fin = patch.fechaFin || null;

  if (patch.precioEntrada !== undefined || patch.moneda !== undefined) {
    const { count } = await sb
      .from("reto_participantes")
      .select("id", { count: "exact", head: true })
      .eq("reto_id", retoId);
    if ((count ?? 0) > 0) {
      return { ok: false, error: "No puedes cambiar el precio con participantes ya inscritos." };
    }
    if (patch.precioEntrada !== undefined) update.precio_entrada = Math.max(0, Math.round(patch.precioEntrada));
    if (patch.moneda !== undefined) update.moneda = patch.moneda === "USD" ? "USD" : "COP";
  }

  const { error } = await sb.from("retos").update(update).eq("id", retoId);
  return error ? { ok: false, error: "No se pudo guardar." } : { ok: true };
}

/** Publica el reto (lo hace visible e inscribible). Exige premios y fechas. */
export async function publishReto(token: string, retoId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return { ok: false, error: "Reto no encontrado." };
  if (reto.estado !== "borrador") return { ok: true }; // ya publicado

  const premios = await loadPremios(sb, retoId);
  if (!premios.length) return { ok: false, error: "Configura al menos un premio antes de publicar." };
  if (!reto.fecha_fin) return { ok: false, error: "Define la fecha de cierre del reto." };
  if (reto.fecha_inicio && new Date(reto.fecha_fin) <= new Date(reto.fecha_inicio)) {
    return { ok: false, error: "La fecha de cierre debe ser posterior a la de inicio." };
  }

  const { error } = await sb.from("retos").update({ estado: "publicado" }).eq("id", retoId);
  return error ? { ok: false, error: "No se pudo publicar." } : { ok: true };
}

// ──────────────────────────────────────────────────
//  CREADOR: premios (lista dinámica ordenada)
// ──────────────────────────────────────────────────

export interface PremioInput {
  titulo: string;
  descripcion?: string;
  tipo: PremioTipo;
}

/**
 * Reemplaza la lista completa de premios en el orden recibido (índice 0 =
 * posición 1 = premio mayor). Bloqueado en cuanto hay ganadores asignados.
 */
export async function setRetoPremios(
  token: string,
  retoId: string,
  premios: PremioInput[]
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return { ok: false, error: "Reto no encontrado." };

  const { count: ganadores } = await sb
    .from("reto_participantes")
    .select("id", { count: "exact", head: true })
    .eq("reto_id", retoId)
    .not("premio_posicion", "is", null);
  if ((ganadores ?? 0) > 0) {
    return { ok: false, error: "Ya hay premios ganados: la lista no se puede modificar." };
  }

  const clean = premios
    .map(p => ({ titulo: p.titulo.trim().slice(0, 140), descripcion: p.descripcion?.trim() || null, tipo: p.tipo }))
    .filter(p => p.titulo);
  if (!clean.length) return { ok: false, error: "Añade al menos un premio con título." };

  await sb.from("reto_premios").delete().eq("reto_id", retoId);
  const { error } = await sb.from("reto_premios").insert(
    clean.map((p, i) => ({ reto_id: retoId, posicion: i + 1, titulo: p.titulo, descripcion: p.descripcion, tipo: p.tipo }))
  );
  return error ? { ok: false, error: "No se pudieron guardar los premios." } : { ok: true };
}

// ──────────────────────────────────────────────────
//  CREADOR: imagen del reto (Nano Banana)
// ──────────────────────────────────────────────────

/** Propone un prompt de imagen a partir del título/descripción del reto. */
export async function proposeRetoImagePrompt(token: string, retoId: string): Promise<{ prompt?: string; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { error: "Sesión inválida" };
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return { error: "Reto no encontrado." };
  const prompt = await craftCoverPrompt(reto.titulo, reto.descripcion || "", false);
  return { prompt };
}

/** Genera la imagen del reto con el prompt (editable) y la guarda. */
export async function generateRetoImage(
  token: string,
  retoId: string,
  prompt: string
): Promise<{ imagenUrl?: string; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { error: "Sesión inválida" };
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return { error: "Reto no encontrado." };

  const finalPrompt = prompt.trim();
  if (!finalPrompt) return { error: "Escribe un prompt para la imagen." };

  const img = await generateCoverImage(finalPrompt);
  if (!img) return { error: "La generación de imagen falló. Intenta de nuevo." };

  const path = `reto-${retoId}/cover.png`;
  const { error: upErr } = await sb.storage
    .from(COVER_BUCKET)
    .upload(path, img, { contentType: "image/png", upsert: true });
  if (upErr) return { error: "No se pudo guardar la imagen." };

  await sb.from("retos").update({ imagen_path: path }).eq("id", retoId);
  // cache-buster: la URL pública es estable, el cliente añade ?v=Date.now()
  return { imagenUrl: publicUrl(sb, COVER_BUCKET, path) ?? undefined };
}

// ──────────────────────────────────────────────────
//  CREADOR: cupos gratis (códigos canjeables)
// ──────────────────────────────────────────────────

/** Genera hasta N códigos nuevos sin exceder cupos_gratis_totales (máx. 10). */
export async function generateCupos(
  token: string,
  retoId: string,
  n: number
): Promise<{ ok: boolean; cupos?: RetoCupo[]; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return { ok: false, error: "Reto no encontrado." };

  const { count: existentes } = await sb
    .from("reto_cupos")
    .select("id", { count: "exact", head: true })
    .eq("reto_id", retoId);
  const tope = Math.min(reto.cupos_gratis_totales, MAX_CUPOS);
  const restantes = tope - (existentes ?? 0);
  const crear = Math.min(Math.max(1, Math.round(n)), restantes);
  if (crear <= 0) return { ok: false, error: `Ya generaste los ${tope} cupos de este reto.` };

  for (let i = 0; i < crear; i++) {
    // Colisión de código (unique) → se reintenta con otro aleatorio.
    for (let intento = 0; intento < 5; intento++) {
      const codigo = cupoCodeFromBytes(crypto.randomBytes(5));
      const { error } = await sb.from("reto_cupos").insert({ reto_id: retoId, codigo });
      if (!error) break;
      if (error.code !== "23505") {
        console.error("[Reto] error generando cupo:", error.message);
        return { ok: false, error: "No se pudieron generar los cupos." };
      }
    }
  }
  const cupos = await listCupos(token, retoId);
  return { ok: true, cupos: cupos ?? [] };
}

/** Lista los cupos del reto con quién canjeó cada uno. */
export async function listCupos(token: string, retoId: string): Promise<RetoCupo[] | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return null;

  const { data: cupos } = await sb
    .from("reto_cupos")
    .select("id, codigo, estado, canjeado_por, fecha_canje")
    .eq("reto_id", retoId)
    .order("created_at");
  if (!cupos?.length) return [];

  const userIds = [...new Set(cupos.map(c => c.canjeado_por).filter(Boolean))] as string[];
  const { data: profs } = userIds.length
    ? await sb.from("profiles").select("id, username, display_name").in("id", userIds)
    : { data: [] as Array<{ id: string; username: string | null; display_name: string | null }> };
  const nombreDe = new Map((profs || []).map(p => [p.id, p.display_name || p.username || "Usuario"]));

  return cupos.map(c => ({
    id: c.id as string,
    codigo: c.codigo as string,
    estado: c.estado as RetoCupo["estado"],
    canjeadoPor: c.canjeado_por ? (nombreDe.get(c.canjeado_por as string) ?? "Usuario") : null,
    fechaCanje: (c.fecha_canje as string) ?? null,
  }));
}

// ──────────────────────────────────────────────────
//  PARTICIPANTE: entrar al reto (cupo o gratis)
// ──────────────────────────────────────────────────

export interface JoinOpts {
  consentContacto?: boolean;
  alias?: string;
  anonimo?: boolean;
}

/** Inscribe al usuario (helper compartido por cupo y reto gratuito). */
async function insertParticipante(
  sb: SupabaseClient,
  retoId: string,
  userId: string,
  via: "pago" | "cupo",
  opts: JoinOpts
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from("reto_participantes").insert({
    reto_id: retoId,
    user_id: userId,
    via,
    consent_contacto: Boolean(opts.consentContacto),
    alias: opts.alias?.trim() ? opts.alias.trim().slice(0, 40) : null,
    anonimo: Boolean(opts.anonimo),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya estás inscrito en este reto." };
    console.error("[Reto] error inscribiendo participante:", error.message);
    return { ok: false, error: "No se pudo completar la inscripción." };
  }
  return { ok: true };
}

/** Vincula la ruta del reto a la biblioteca del participante (permanente). */
async function linkRuta(sb: SupabaseClient, userId: string, rutaId: string): Promise<void> {
  await sb
    .from("route_starts")
    .upsert({ user_id: userId, route_id: rutaId }, { onConflict: "user_id,route_id", ignoreDuplicates: true });
}

/**
 * Canjea un código de cupo gratis: valida, marca el código como canjeado de
 * forma ATÓMICA (update condicional) e inscribe al participante. Compite en
 * igualdad de condiciones que un participante de pago.
 */
export async function redeemCupo(
  token: string,
  retoId: string,
  codigo: string,
  opts: JoinOpts = {}
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Inicia sesión para canjear tu código." };
  const sb = supabaseAdmin();

  const { data: retoRow } = await sb.from("retos").select(RETO_COLS).eq("id", retoId).maybeSingle();
  if (!retoRow) return { ok: false, error: "Reto no encontrado." };
  const reto = retoRow as RetoDbRow;
  if (reto.creador_id === user.id) return { ok: false, error: "No puedes participar en tu propio reto." };

  const normalizado = codigo.trim().toUpperCase();
  const [{ data: cupo }, { data: yaParte }] = await Promise.all([
    sb.from("reto_cupos").select("id, reto_id, estado").eq("codigo", normalizado).maybeSingle(),
    sb.from("reto_participantes").select("id").eq("reto_id", retoId).eq("user_id", user.id).maybeSingle(),
  ]);

  const check = validateCupoRedemption(
    cupo ? { estado: cupo.estado as string, retoId: cupo.reto_id as string } : null,
    { id: reto.id, estadoEfectivo: estadoEfectivoDe(reto) },
    Boolean(yaParte)
  );
  if (!check.ok) return { ok: false, error: check.error };

  // Canje atómico: solo UNA request puede pasar 'disponible' → 'canjeado'.
  const { data: canjeado } = await sb
    .from("reto_cupos")
    .update({ estado: "canjeado", canjeado_por: user.id, fecha_canje: new Date().toISOString() })
    .eq("id", cupo!.id)
    .eq("estado", "disponible")
    .select("id");
  if (!canjeado?.length) return { ok: false, error: "Este código ya fue canjeado." };

  const ins = await insertParticipante(sb, retoId, user.id, "cupo", opts);
  if (!ins.ok) {
    // Devolver el código si la inscripción falló (p. ej. carrera de doble join).
    await sb.from("reto_cupos").update({ estado: "disponible", canjeado_por: null, fecha_canje: null }).eq("id", cupo!.id);
    return ins;
  }

  // Contador sin drift: recomputado desde la fuente.
  const { count: usados } = await sb
    .from("reto_cupos")
    .select("id", { count: "exact", head: true })
    .eq("reto_id", retoId)
    .eq("estado", "canjeado");
  await sb.from("retos").update({ cupos_gratis_usados: usados ?? 0 }).eq("id", retoId);

  await linkRuta(sb, user.id, reto.ruta_id);
  console.log(`[Reto] cupo ${normalizado} canjeado: reto=${retoId} user=${user.id}`);
  return { ok: true };
}

/** Inscripción directa cuando el reto es gratuito (precio_entrada = 0). */
export async function joinRetoGratis(
  token: string,
  retoId: string,
  opts: JoinOpts = {}
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Inicia sesión para inscribirte." };
  const sb = supabaseAdmin();

  const { data: retoRow } = await sb.from("retos").select(RETO_COLS).eq("id", retoId).maybeSingle();
  if (!retoRow) return { ok: false, error: "Reto no encontrado." };
  const reto = retoRow as RetoDbRow;
  if (reto.creador_id === user.id) return { ok: false, error: "No puedes participar en tu propio reto." };
  if (reto.precio_entrada > 0) return { ok: false, error: "Este reto requiere pago o un código de cupo." };
  const estado = estadoEfectivoDe(reto);
  if (estado !== "publicado" && estado !== "en_curso") {
    return { ok: false, error: "Este reto no está aceptando inscripciones." };
  }

  const ins = await insertParticipante(sb, retoId, user.id, "pago", opts);
  if (!ins.ok) return ins;
  await linkRuta(sb, user.id, reto.ruta_id);
  return { ok: true };
}

// ──────────────────────────────────────────────────
//  LECTURAS: panel del creador, ficha pública, biblioteca
// ──────────────────────────────────────────────────

/** Retos del creador (para "Mis Retos"). */
export async function getMisRetos(token: string): Promise<Reto[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("retos")
    .select(RETO_COLS)
    .eq("creador_id", user.id)
    .order("created_at", { ascending: false });
  return Promise.all(((data as RetoDbRow[]) || []).map(r => toReto(sb, r)));
}

/** Dashboard en vivo del reto (solo el creador). */
export async function getRetoDashboard(token: string, retoId: string): Promise<RetoDashboardData | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();

  // Cierre perezoso: si venció, finaliza y anuncia ganadores (una vez).
  try {
    await finalizeRetoIfDueCore(retoId);
  } catch (e) {
    console.warn("[Reto] finalize falló:", e);
  }

  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return null;

  const [leaderboard, cupos, { data: movs }] = await Promise.all([
    buildLeaderboard(sb, reto, { includeVia: true }),
    listCupos(token, retoId),
    sb.from("wallet_movimientos").select("monto_bruto, monto_creador").eq("reto_id", retoId),
  ]);

  const inscritosPago = leaderboard.filter(e => e.via === "pago").length;
  return {
    reto: await toReto(sb, reto),
    leaderboard,
    inscritos: leaderboard.length,
    inscritosPago,
    inscritosCupo: leaderboard.length - inscritosPago,
    ingresoBruto: (movs || []).reduce((s, m) => s + Number(m.monto_bruto), 0),
    ingresoCreador: (movs || []).reduce((s, m) => s + Number(m.monto_creador), 0),
    cupos: cupos ?? [],
  };
}

/**
 * Ficha pública del reto. `token` puede ser null (links compartidos): los
 * anónimos ven todo menos su progreso. Nunca expone datos de contacto.
 */
export async function getRetoPublic(token: string | null, retoId: string): Promise<RetoPublicData | null> {
  const user = token ? await getUserFromToken(token) : null;
  const sb = supabaseAdmin();

  try {
    await finalizeRetoIfDueCore(retoId);
  } catch (e) {
    console.warn("[Reto] finalize falló:", e);
  }

  const { data: retoRow } = await sb.from("retos").select(RETO_COLS).eq("id", retoId).maybeSingle();
  if (!retoRow) return null;
  const reto = retoRow as RetoDbRow;
  const estado = estadoEfectivoDe(reto);
  const soyCreador = user?.id === reto.creador_id;
  // Los borradores solo los ve su creador.
  if (estado === "borrador" && !soyCreador) return null;

  const [premios, leaderboard, { data: creator }, { count: totalLecciones }, { count: cuposLibres }] =
    await Promise.all([
      loadPremios(sb, retoId),
      buildLeaderboard(sb, reto, { includeVia: false }),
      sb.from("profiles").select("username, display_name, avatar_path").eq("id", reto.creador_id).maybeSingle(),
      sb.from("lessons").select("id", { count: "exact", head: true }).eq("route_id", reto.ruta_id),
      sb.from("reto_cupos").select("id", { count: "exact", head: true }).eq("reto_id", retoId).eq("estado", "disponible"),
    ]);

  const ganadores = leaderboard.filter(e => e.premioPosicion != null);

  // Progreso del viewer (si participa).
  let miProgreso: MyRetoProgress | null = null;
  if (user && !soyCreador) {
    const { data: part } = await sb
      .from("reto_participantes")
      .select("user_id, alias, anonimo, finalizacion_verificada_at, premio_posicion")
      .eq("reto_id", retoId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (part) {
      const lessons = await loadRetoLessons(sb, reto.ruta_id);
      const { data: attempts } = await sb
        .from("attempts")
        .select("node_id, detail")
        .eq("route_id", reto.ruta_id)
        .eq("user_id", user.id)
        .eq("passed", true);
      const result = isVerifiedComplete(
        lessons,
        (attempts || []).map(a => ({
          nodeId: a.node_id as string,
          passed: true,
          attention: (a.detail as { attention?: { correct: number; total: number } } | null)?.attention ?? null,
        }))
      );
      const posicionesGanadas = new Set(ganadores.map(g => g.premioPosicion));
      const siguienteLibre = premios.find(p => !posicionesGanadas.has(p.posicion)) ?? null;
      // Posición = 1 + cuántos van por delante (finalizaron antes, o llevan
      // más % verificado si yo aún no termino).
      const yoFinalice = part.finalizacion_verificada_at as string | null;
      const myPct = yoFinalice ? 100 : result.completionPct;
      const delante = leaderboard.filter(e => {
        if (e.finalizadoAt && yoFinalice) return Date.parse(e.finalizadoAt) < Date.parse(yoFinalice);
        if (e.finalizadoAt && !yoFinalice) return true;
        if (!e.finalizadoAt && yoFinalice) return false;
        return e.completionPct > myPct;
      }).length;
      miProgreso = {
        completionPct: myPct,
        posicion: delante + 1,
        finalizadoAt: (part.finalizacion_verificada_at as string) ?? null,
        premioPosicion: (part.premio_posicion as number) ?? null,
        premioTitulo:
          part.premio_posicion != null
            ? (premios.find(p => p.posicion === part.premio_posicion)?.titulo ?? null)
            : null,
        premioSiTerminaAhora: part.finalizacion_verificada_at ? null : siguienteLibre,
      };
    }
  }

  const { data: ruta } = await sb.from("routes").select("cover_path").eq("id", reto.ruta_id).maybeSingle();

  return {
    id: reto.id,
    titulo: reto.titulo,
    descripcion: reto.descripcion,
    imagenUrl:
      publicUrl(sb, COVER_BUCKET, reto.imagen_path) ?? publicUrl(sb, COVER_BUCKET, ruta?.cover_path ?? null),
    precioEntrada: reto.precio_entrada,
    moneda: (reto.moneda as RetoMoneda) || "COP",
    fechaInicio: reto.fecha_inicio,
    fechaFin: reto.fecha_fin,
    estadoEfectivo: estado,
    reglas: reto.reglas,
    premios,
    premiosRestantes: Math.max(0, premios.length - ganadores.length),
    inscritos: leaderboard.length,
    cuposGratisDisponibles: cuposLibres ?? 0,
    totalLecciones: totalLecciones ?? 0,
    creator: {
      username: (creator?.username as string) ?? null,
      displayName: (creator?.display_name as string) ?? null,
      avatarUrl: publicUrl(sb, AVATAR_BUCKET, (creator?.avatar_path as string) ?? null),
    },
    rutaId: reto.ruta_id,
    leaderboard: leaderboard.slice(0, 100),
    ganadores,
    miProgreso,
    soyCreador,
  };
}

/** Retos en los que participo (biblioteca personal, acceso permanente). */
export async function getMisRetosParticipando(token: string): Promise<RetoParticipando[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];
  const sb = supabaseAdmin();

  const { data: parts } = await sb
    .from("reto_participantes")
    .select("reto_id, premio_posicion, finalizacion_verificada_at")
    .eq("user_id", user.id)
    .order("inscrito_at", { ascending: false });
  if (!parts?.length) return [];

  const { data: retos } = await sb
    .from("retos")
    .select(RETO_COLS)
    .in("id", parts.map(p => p.reto_id));
  const retoDe = new Map(((retos as RetoDbRow[]) || []).map(r => [r.id, r]));

  const out: RetoParticipando[] = [];
  for (const p of parts) {
    const reto = retoDe.get(p.reto_id as string);
    if (!reto) continue;
    let completionPct = 100;
    if (!p.finalizacion_verificada_at) {
      const lessons = await loadRetoLessons(sb, reto.ruta_id);
      const { data: attempts } = await sb
        .from("attempts")
        .select("node_id, detail")
        .eq("route_id", reto.ruta_id)
        .eq("user_id", user.id)
        .eq("passed", true);
      completionPct = isVerifiedComplete(
        lessons,
        (attempts || []).map(a => ({
          nodeId: a.node_id as string,
          passed: true,
          attention: (a.detail as { attention?: { correct: number; total: number } } | null)?.attention ?? null,
        }))
      ).completionPct;
    }
    const { data: ruta } = await sb.from("routes").select("cover_path").eq("id", reto.ruta_id).maybeSingle();
    out.push({
      retoId: reto.id,
      titulo: reto.titulo,
      imagenUrl:
        publicUrl(sb, COVER_BUCKET, reto.imagen_path) ?? publicUrl(sb, COVER_BUCKET, ruta?.cover_path ?? null),
      rutaId: reto.ruta_id,
      estadoEfectivo: estadoEfectivoDe(reto),
      completionPct,
      premioPosicion: (p.premio_posicion as number) ?? null,
    });
  }
  return out;
}

// ──────────────────────────────────────────────────
//  CREADOR: superfans (CSV con consentimiento)
// ──────────────────────────────────────────────────

/**
 * CSV de superfans ordenado por desempeño. SOLO incluye a quienes marcaron el
 * checkbox de consentimiento en la inscripción. Separador ';' y BOM para que
 * Excel es-CO lo abra directo.
 */
export async function exportSuperfansCSV(token: string, retoId: string): Promise<{ csv?: string; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { error: "Sesión inválida" };
  const sb = supabaseAdmin();
  const reto = await loadOwnReto(sb, user.id, retoId);
  if (!reto) return { error: "Reto no encontrado." };

  const { data: parts } = await sb
    .from("reto_participantes")
    .select("user_id, via, alias, inscrito_at, finalizacion_verificada_at, atencion_score, premio_posicion, consent_contacto")
    .eq("reto_id", retoId)
    .eq("consent_contacto", true);
  if (!parts?.length) return { csv: "﻿Sin participantes con consentimiento de contacto todavía." };

  const lessons = await loadRetoLessons(sb, reto.ruta_id);
  const { data: attempts } = await sb
    .from("attempts")
    .select("user_id, node_id, detail")
    .eq("route_id", reto.ruta_id)
    .eq("passed", true);
  const byUser = new Map<string, Array<{ nodeId: string; passed: boolean; attention: { correct: number; total: number } | null }>>();
  for (const a of attempts || []) {
    const uid = a.user_id as string;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push({
      nodeId: a.node_id as string,
      passed: true,
      attention: (a.detail as { attention?: { correct: number; total: number } } | null)?.attention ?? null,
    });
  }

  const { data: profs } = await sb
    .from("profiles")
    .select("id, email, username, display_name")
    .in("id", parts.map(p => p.user_id));
  const profDe = new Map((profs || []).map(p => [p.id as string, p]));

  const rows = parts
    .map(p => {
      const prof = profDe.get(p.user_id as string);
      const r = isVerifiedComplete(lessons, byUser.get(p.user_id as string) ?? []);
      return {
        nombre: (p.alias as string) || (prof?.display_name as string) || (prof?.username as string) || "Usuario",
        email: (prof?.email as string) || "",
        completionPct: p.finalizacion_verificada_at ? 100 : r.completionPct,
        verificado: p.finalizacion_verificada_at ? "sí" : "no",
        premio: p.premio_posicion != null ? String(p.premio_posicion) : "",
        via: p.via as string,
        inscrito: (p.inscrito_at as string)?.slice(0, 10) ?? "",
      };
    })
    .sort((a, b) => b.completionPct - a.completionPct);

  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [
    ["Nombre", "Email", "% completado", "Verificado", "Premio", "Vía", "Inscripción"].join(";"),
    ...rows.map(r => [esc(r.nombre), esc(r.email), String(r.completionPct), r.verificado, r.premio, r.via, r.inscrito].join(";")),
  ];
  return { csv: "﻿" + lines.join("\n") };
}

// ──────────────────────────────────────────────────
//  CREADOR: wallet + datos bancarios (SENSIBLE)
// ──────────────────────────────────────────────────

/** Wallet del creador: saldo, histórico y datos bancarios (solo el dueño). */
export async function getWallet(token: string): Promise<WalletResumen | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();

  const [{ data: movs }, { data: banca }] = await Promise.all([
    sb
      .from("wallet_movimientos")
      .select("id, reto_id, participante_id, monto_bruto, monto_creador, monto_plataforma, moneda, estado, created_at")
      .eq("creador_id", user.id)
      .order("created_at", { ascending: false }),
    sb
      .from("creador_datos_bancarios")
      .select("titular, documento, banco, tipo_cuenta, numero")
      .eq("creador_id", user.id)
      .maybeSingle(),
  ]);

  const retoIds = [...new Set((movs || []).map(m => m.reto_id))];
  const { data: retos } = retoIds.length
    ? await sb.from("retos").select("id, titulo").in("id", retoIds)
    : { data: [] as Array<{ id: string; titulo: string }> };
  const tituloDe = new Map((retos || []).map(r => [r.id, r.titulo]));

  const partIds = [...new Set((movs || []).map(m => m.participante_id).filter(Boolean))] as string[];
  const { data: parts } = partIds.length
    ? await sb.from("reto_participantes").select("id, user_id, alias, anonimo").in("id", partIds)
    : { data: [] as Array<{ id: string; user_id: string; alias: string | null; anonimo: boolean }> };
  const userIds = [...new Set((parts || []).map(p => p.user_id))];
  const { data: profs } = userIds.length
    ? await sb.from("profiles").select("id, username, display_name").in("id", userIds)
    : { data: [] as Array<{ id: string; username: string | null; display_name: string | null }> };
  const profDe = new Map((profs || []).map(p => [p.id, p]));
  const nombreDe = new Map(
    (parts || []).map(p => {
      const prof = profDe.get(p.user_id);
      return [p.id, p.anonimo ? "Anónimo" : p.alias || prof?.display_name || prof?.username || "Usuario"];
    })
  );

  const movimientos: WalletMovimiento[] = (movs || []).map(m => ({
    id: m.id as string,
    retoTitulo: tituloDe.get(m.reto_id as string) ?? "Reto",
    participante: m.participante_id ? (nombreDe.get(m.participante_id as string) ?? null) : null,
    montoBruto: Number(m.monto_bruto),
    montoCreador: Number(m.monto_creador),
    montoPlataforma: Number(m.monto_plataforma),
    moneda: (m.moneda as RetoMoneda) || "COP",
    estado: m.estado as WalletMovimiento["estado"],
    fecha: m.created_at as string,
  }));

  return {
    saldoDisponible: movimientos.filter(m => m.estado === "disponible").reduce((s, m) => s + m.montoCreador, 0),
    totalAcreditado: movimientos.reduce((s, m) => s + m.montoCreador, 0),
    moneda: movimientos[0]?.moneda ?? "COP",
    movimientos,
    datosBancarios: banca
      ? {
          titular: (banca.titular as string) ?? "",
          documento: (banca.documento as string) ?? "",
          banco: (banca.banco as string) ?? "",
          tipoCuenta: (banca.tipo_cuenta as DatosBancarios["tipoCuenta"]) ?? "ahorros",
          numero: (banca.numero as string) ?? "",
        }
      : null,
  };
}

/**
 * Guarda los datos bancarios de payout del creador. SENSIBLE: no se loggea el
 * contenido y solo el dueño puede leerlos (getWallet) o el admin en su panel.
 */
export async function saveDatosBancarios(token: string, datos: DatosBancarios): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const sb = supabaseAdmin();

  const { error } = await sb.from("creador_datos_bancarios").upsert(
    {
      creador_id: user.id,
      titular: datos.titular.trim().slice(0, 140),
      documento: datos.documento.trim().slice(0, 40),
      banco: datos.banco.trim().slice(0, 80),
      tipo_cuenta: datos.tipoCuenta === "corriente" ? "corriente" : "ahorros",
      numero: datos.numero.trim().slice(0, 40),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "creador_id" }
  );
  if (error) {
    // Nunca loggear el payload: solo el hecho del fallo.
    console.error("[Wallet] no se pudieron guardar los datos bancarios del creador", user.id);
    return { ok: false, error: "No se pudieron guardar los datos." };
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────
//  Remediación manual (misma vía que el admin de pagos usa para premium)
// ──────────────────────────────────────────────────

/** Re-procesa una orden de reto pagada (por si el webhook falló). */
export async function reprocessRetoOrder(token: string, orderRef: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };
  await fulfillRetoOrderCore(supabaseAdmin(), orderRef);
  return { ok: true };
}
