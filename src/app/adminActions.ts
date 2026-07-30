"use server";

// Server actions de administración. Solo accesibles para perfiles con role='admin'.
// Permiten al admin regalar cuota de creación de rutas a cualquier usuario.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { categoryLabel } from "@/lib/types";
import { upgradeProfileToPremium, activatePremiumByOrder, PREMIUM_QUOTA } from "@/lib/premium";
import { isMembershipActive } from "@/lib/sessionBudget";
import { MEMBERSHIP_DAYS } from "@/lib/pricing";
import { SESSION_BUDGET } from "@/lib/sessionGate";

const AVATAR_BUCKET = "avatars";
const COVER_BUCKET = "route-covers";
const AUDIO_BUCKET = "lesson-audio";

async function requireAdmin(token: string): Promise<{ id: string } | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const { data } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (data?.role !== "admin") return null;
  return { id: user.id };
}

export async function checkIsAdmin(token: string): Promise<boolean> {
  return (await requireAdmin(token)) !== null;
}

export interface AdminUserRow {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  plan: string;
  role: string;
  routeQuota: number;
  routesUsed: number;
  batchEnabled: boolean;
  /** Membresía mensual vigente (o fundador). `plan` solo dice si alguna vez pagó. */
  membershipActive: boolean;
  founder: boolean;
  premiumUntil: string | null;
}

export async function adminListUsers(token: string, search = ""): Promise<AdminUserRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  let q = sb
    .from("profiles")
    .select("id, email, username, display_name, avatar_path, plan, role, route_quota, batch_enabled, created_at, premium_until, founder")
    .order("created_at", { ascending: false })
    .limit(100);

  const term = search.trim();
  if (term) q = q.or(`email.ilike.%${term}%,username.ilike.%${term}%,display_name.ilike.%${term}%`);

  const { data: profiles } = await q;
  const rows = profiles || [];
  const ids = rows.map(r => r.id);

  // Rutas creadas por cada usuario
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: routes } = await sb.from("routes").select("owner_id").in("owner_id", ids);
    for (const r of routes || []) counts.set(r.owner_id, (counts.get(r.owner_id) ?? 0) + 1);
  }

  return rows.map(r => ({
    id: r.id,
    email: r.email,
    username: r.username ?? null,
    displayName: r.display_name ?? null,
    avatarUrl: r.avatar_path ? supabaseAdmin().storage.from(AVATAR_BUCKET).getPublicUrl(r.avatar_path).data.publicUrl : null,
    plan: r.plan || "free",
    role: r.role || "user",
    routeQuota: r.route_quota ?? 1,
    routesUsed: counts.get(r.id) ?? 0,
    batchEnabled: Boolean(r.batch_enabled),
    founder: Boolean(r.founder),
    premiumUntil: (r.premium_until as string | null) ?? null,
    membershipActive: isMembershipActive({
      plan: r.plan || "free",
      founder: Boolean(r.founder),
      premiumUntil: (r.premium_until as string | null) ?? null,
    }),
  }));
}

/** Activa/desactiva la creación de rutas en lote para un usuario (exclusiva). */
export async function adminSetBatchEnabled(token: string, userId: string, enabled: boolean): Promise<{ ok: boolean; error?: string; batchEnabled?: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };

  const sb = supabaseAdmin();
  const { error } = await sb.from("profiles").update({ batch_enabled: enabled }).eq("id", userId);
  if (error) return { ok: false, error: "No se pudo actualizar el acceso al lote." };
  return { ok: true, batchEnabled: enabled };
}

/** Fija la cuota de creación de rutas de un usuario (valor absoluto). */
export async function adminSetUserQuota(token: string, userId: string, quota: number): Promise<{ ok: boolean; error?: string; routeQuota?: number }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };

  const q = Math.max(0, Math.min(999, Math.round(quota)));
  const sb = supabaseAdmin();
  const { error } = await sb.from("profiles").update({ route_quota: q }).eq("id", userId);
  if (error) return { ok: false, error: "No se pudo actualizar la cuota." };
  return { ok: true, routeQuota: q };
}

/** Suma (o resta) rutas a la cuota actual de un usuario. */
export async function adminGrantRoutes(token: string, userId: string, delta: number): Promise<{ ok: boolean; error?: string; routeQuota?: number }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };

  const sb = supabaseAdmin();
  const { data: profile } = await sb.from("profiles").select("route_quota").eq("id", userId).single();
  const current = profile?.route_quota ?? 1;
  return adminSetUserQuota(token, userId, current + delta);
}

// ──────────────────────────────────────────────────
//  Perfil de estudio de un usuario. El admin entra al perfil y ve EXACTAMENTE
//  qué ha estudiado: todas las rutas que comenzó (incluso sin haber completado
//  ni la primera lección) y su avance en cada una.
// ──────────────────────────────────────────────────

export interface AdminStudyRoute {
  routeId: string;
  topic: string;
  coverUrl: string | null;
  ownerName: string;
  totalNodes: number;
  completedNodes: number;
  completionPct: number;
  avgStars: number | null;
  startedAt: string | null;       // cuándo abrió la ruta (matrícula implícita)
  lastActivityAt: string | null;  // último intento registrado
  status: string;                 // estado de generación de la ruta
  blocked: boolean;
  visibility: "public" | "private";
}

export interface AdminUserStudy {
  user: {
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    plan: string;
    role: string;
    createdAt: string | null;
    routesCompleted: number;
    avgStars: number;
  };
  routes: AdminStudyRoute[];
}

export async function adminGetUserStudy(token: string, userId: string): Promise<AdminUserStudy | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

  const { data: profile } = await sb
    .from("profiles")
    .select("id, email, username, display_name, avatar_path, plan, role, created_at, routes_completed, avg_stars")
    .eq("id", userId)
    .single();
  if (!profile) return null;

  // Rutas comenzadas (matrícula implícita) + rutas con intentos. La unión cubre
  // las que abrió aunque no haya hecho ni una lección.
  const [{ data: starts }, { data: attempts }] = await Promise.all([
    sb.from("route_starts").select("route_id, started_at").eq("user_id", userId),
    sb.from("attempts").select("route_id, node_id, stars, passed, created_at").eq("user_id", userId),
  ]);

  const startedMap = new Map<string, string>((starts || []).map(s => [s.route_id, s.started_at]));
  const routeIds = [...new Set([...startedMap.keys(), ...(attempts || []).map(a => a.route_id)])];
  if (routeIds.length === 0) {
    return {
      user: {
        id: profile.id, email: profile.email, username: profile.username ?? null,
        displayName: profile.display_name ?? null,
        avatarUrl: profile.avatar_path ? sb.storage.from(AVATAR_BUCKET).getPublicUrl(profile.avatar_path).data.publicUrl : null,
        plan: profile.plan || "free", role: profile.role || "user", createdAt: profile.created_at ?? null,
        routesCompleted: profile.routes_completed ?? 0, avgStars: profile.avg_stars ?? 0,
      },
      routes: [],
    };
  }

  const [{ data: routes }, { data: lessons }] = await Promise.all([
    sb.from("routes").select("id, topic, owner_id, cover_path, status, blocked, visibility").in("id", routeIds),
    sb.from("lessons").select("route_id").in("route_id", routeIds),
  ]);

  // Nombre del creador de cada ruta
  const ownerIds = [...new Set((routes || []).map(r => r.owner_id))];
  const { data: owners } = await sb.from("profiles").select("id, username, display_name, email").in("id", ownerIds);
  const ownerMap = new Map((owners || []).map(o => [o.id, o]));

  // Total de lecciones por ruta
  const totalByRoute = new Map<string, number>();
  for (const l of lessons || []) totalByRoute.set(l.route_id, (totalByRoute.get(l.route_id) ?? 0) + 1);

  // Avance del usuario por ruta: mejor estrella por nodo aprobado + última actividad
  const bestByRouteNode = new Map<string, Map<string, number>>();
  const lastActivity = new Map<string, string>();
  for (const a of attempts || []) {
    if (a.created_at && (!lastActivity.has(a.route_id) || a.created_at > lastActivity.get(a.route_id)!)) {
      lastActivity.set(a.route_id, a.created_at);
    }
    if (!a.passed) continue;
    if (!bestByRouteNode.has(a.route_id)) bestByRouteNode.set(a.route_id, new Map());
    const nodes = bestByRouteNode.get(a.route_id)!;
    nodes.set(a.node_id, Math.max(nodes.get(a.node_id) ?? 0, a.stars));
  }

  const result: AdminStudyRoute[] = (routes || []).map(r => {
    const nodes = bestByRouteNode.get(r.id);
    const completedNodes = nodes?.size ?? 0;
    const total = totalByRoute.get(r.id) ?? 0;
    const bests = nodes ? [...nodes.values()] : [];
    const o = ownerMap.get(r.owner_id);
    return {
      routeId: r.id,
      topic: r.topic,
      coverUrl: r.cover_path ? sb.storage.from(COVER_BUCKET).getPublicUrl(r.cover_path).data.publicUrl : null,
      ownerName: o?.display_name || (o?.username ? `@${o.username}` : o?.email) || "—",
      totalNodes: total,
      completedNodes,
      completionPct: total > 0 ? Math.min(100, Math.round((completedNodes / total) * 100)) : 0,
      avgStars: bests.length ? Math.round((bests.reduce((a, b) => a + b, 0) / bests.length) * 10) / 10 : null,
      startedAt: startedMap.get(r.id) ?? null,
      lastActivityAt: lastActivity.get(r.id) ?? null,
      status: r.status || "ready",
      blocked: Boolean(r.blocked),
      visibility: r.visibility === "private" ? "private" : "public",
    };
  });

  // Orden: actividad más reciente primero; si nunca avanzó, por fecha de inicio.
  result.sort((a, b) => {
    const ka = a.lastActivityAt || a.startedAt || "";
    const kb = b.lastActivityAt || b.startedAt || "";
    return kb.localeCompare(ka);
  });

  return {
    user: {
      id: profile.id, email: profile.email, username: profile.username ?? null,
      displayName: profile.display_name ?? null,
      avatarUrl: profile.avatar_path ? sb.storage.from(AVATAR_BUCKET).getPublicUrl(profile.avatar_path).data.publicUrl : null,
      plan: profile.plan || "free", role: profile.role || "user", createdAt: profile.created_at ?? null,
      routesCompleted: profile.routes_completed ?? 0, avgStars: profile.avg_stars ?? 0,
    },
    routes: result,
  };
}

// ──────────────────────────────────────────────────
//  Moderación de cursos. El admin ve TODAS las rutas (de cualquier usuario)
//  y puede: ponerlas en privado, sacarlas del aire (blocked, reversible) o
//  borrarlas para siempre.
// ──────────────────────────────────────────────────

export interface AdminRouteRow {
  id: string;
  topic: string;
  ownerName: string;
  ownerEmail: string;
  visibility: "public" | "private";
  blocked: boolean;
  category: string;
  categoryLabel: string;
  coverUrl: string | null;
  studentCount: number;
  createdAt: string;
}

export async function adminListRoutes(token: string, search = ""): Promise<AdminRouteRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  let q = sb
    .from("routes")
    .select("id, topic, owner_id, visibility, blocked, category, cover_path, student_count, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const term = search.trim();
  if (term) q = q.ilike("topic", `%${term}%`);

  const { data: routes } = await q;
  const rows = routes || [];
  if (rows.length === 0) return [];

  // Datos del creador de cada ruta
  const ownerIds = [...new Set(rows.map(r => r.owner_id))];
  const { data: owners } = await sb.from("profiles").select("id, username, display_name, email").in("id", ownerIds);
  const ownerMap = new Map((owners || []).map(o => [o.id, o]));

  return rows.map(r => {
    const o = ownerMap.get(r.owner_id);
    return {
      id: r.id,
      topic: r.topic,
      ownerName: o?.display_name || (o?.username ? `@${o.username}` : o?.email) || "—",
      ownerEmail: o?.email || "",
      visibility: r.visibility === "private" ? "private" : "public",
      blocked: Boolean(r.blocked),
      category: r.category || "otros",
      categoryLabel: categoryLabel(r.category || "otros"),
      coverUrl: r.cover_path ? sb.storage.from(COVER_BUCKET).getPublicUrl(r.cover_path).data.publicUrl : null,
      studentCount: r.student_count ?? 0,
      createdAt: r.created_at,
    };
  });
}

/** Cambia la visibilidad de cualquier ruta (público/privado). */
export async function adminSetRouteVisibility(token: string, routeId: string, visibility: "public" | "private"): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();
  const { error } = await sb.from("routes").update({ visibility }).eq("id", routeId);
  if (error) return { ok: false, error: "No se pudo cambiar la visibilidad." };
  return { ok: true };
}

/** Saca del aire / reactiva una ruta. Bloqueada = invisible en todas partes (reversible). */
export async function adminSetRouteBlocked(token: string, routeId: string, blocked: boolean): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();
  const { error } = await sb.from("routes").update({ blocked }).eq("id", routeId);
  if (error) return { ok: false, error: "No se pudo actualizar el estado de la ruta." };
  return { ok: true };
}

/** Borra para siempre cualquier ruta (audios + portadas + fila, cascada). */
export async function adminDeleteRoute(token: string, routeId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  const { data: route } = await sb.from("routes").select("topic").eq("id", routeId).single();
  if (!route) return { ok: false, error: "Ruta no encontrada" };

  // Storage: audios de lecciones y portadas viven bajo el prefijo routeId/
  for (const bucket of [AUDIO_BUCKET, COVER_BUCKET]) {
    try {
      const { data: files } = await sb.storage.from(bucket).list(routeId, { limit: 200 });
      if (files?.length) await sb.storage.from(bucket).remove(files.map(f => `${routeId}/${f.name}`));
    } catch (e) {
      console.warn(`[AdminDelete] No se pudo limpiar ${bucket}/${routeId}:`, e);
    }
  }

  const { error } = await sb.from("routes").delete().eq("id", routeId);
  if (error) return { ok: false, error: "No se pudo eliminar la ruta." };
  console.log(`[AdminDelete] ✓ Ruta ${routeId} ("${route.topic}") eliminada por el admin.`);
  return { ok: true };
}

// ──────────────────────────────────────────────────
//  PAGOS (Bold). El admin ve: la URL del webhook (para pegarla en Bold), si las
//  llaves están configuradas, las órdenes recientes (con el plan actual del
//  comprador) y las últimas confirmaciones crudas que llegaron al webhook.
//  Además puede activar Premium a mano (remediación de pagos que no activaron).
// ──────────────────────────────────────────────────

export interface BoldOrderRow {
  orderId: string;
  userId: string;
  email: string;
  amount: number;
  currency: string;
  purpose: string;
  status: string; // pending | paid
  userPlan: string; // free | premium (plan actual del comprador)
  createdAt: string;
}

export interface BoldTxRow {
  paymentId: string;
  type: string;
  amount: number;
  currency: string;
  orderReference: string | null;
  createdAt: string;
}

export interface BoldOverview {
  /** BOLD_API_KEY y BOLD_SECRET_KEY presentes en el entorno. */
  configured: boolean;
  /** BOLD_WEBHOOK_ENFORCE_SIGNATURE === "true". */
  signatureEnforced: boolean;
  /** false → falta crear la tabla (corre scripts/bold-setup.sql). */
  ordersTableReady: boolean;
  transactionsTableReady: boolean;
  orders: BoldOrderRow[];
  transactions: BoldTxRow[];
}

export async function adminGetBoldOverview(token: string): Promise<BoldOverview | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

  const configured = Boolean(process.env.BOLD_API_KEY && process.env.BOLD_SECRET_KEY);
  const signatureEnforced = process.env.BOLD_WEBHOOK_ENFORCE_SIGNATURE === "true";

  // Órdenes recientes + plan actual del comprador (para detectar pagos que no activaron).
  let orders: BoldOrderRow[] = [];
  let ordersTableReady = true;
  const { data: orderRows, error: ordErr } = await sb
    .from("payment_orders")
    .select("order_id, user_id, amount, currency, purpose, status, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (ordErr) {
    ordersTableReady = false;
  } else if (orderRows?.length) {
    const ids = [...new Set(orderRows.map(o => o.user_id))];
    const { data: profs } = await sb.from("profiles").select("id, email, plan").in("id", ids);
    const pmap = new Map((profs || []).map(p => [p.id, p]));
    orders = orderRows.map(o => ({
      orderId: o.order_id,
      userId: o.user_id,
      email: pmap.get(o.user_id)?.email || "—",
      amount: Number(o.amount) || 0,
      currency: o.currency || "COP",
      purpose: o.purpose || "premium",
      status: o.status || "pending",
      userPlan: pmap.get(o.user_id)?.plan || "free",
      createdAt: o.created_at,
    }));
  }

  // Últimas confirmaciones crudas que llegaron al webhook.
  let transactions: BoldTxRow[] = [];
  let transactionsTableReady = true;
  const { data: txRows, error: txErr } = await sb
    .from("bold_transactions")
    .select("payment_id, transaction_type, amount_total, amount_currency, order_reference, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (txErr) {
    transactionsTableReady = false;
  } else {
    transactions = (txRows || []).map(t => ({
      paymentId: t.payment_id,
      type: t.transaction_type,
      amount: Number(t.amount_total) || 0,
      currency: t.amount_currency || "COP",
      orderReference: t.order_reference ?? null,
      createdAt: t.created_at,
    }));
  }

  return { configured, signatureEnforced, ordersTableReady, transactionsTableReady, orders, transactions };
}

/**
 * Activa Premium a mano (remediación). Si se pasa orderId, marca también la orden
 * como pagada. Idempotente y tolerante al esquema (reutiliza la misma lógica que
 * el webhook).
 */
export async function adminActivatePremium(
  token: string,
  userId: string,
  orderId?: string,
  /** Días de membresía a regalar en la activación manual (por defecto, un mes). */
  grantDays?: number
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false, error: "No autorizado" };
  const sb = supabaseAdmin();

  // Con orden: usa el MISMO camino idempotente que el webhook. Marca la orden
  // pagada y suma la cuota premium UNA sola vez (si ya estaba 'paid', no vuelve
  // a sumar aunque el admin pulse el botón otra vez).
  if (orderId) {
    await activatePremiumByOrder(sb, orderId);
  }

  // Garantiza el plan aunque la orden ya estuviera 'paid' pero el perfil no se
  // hubiera subido (caso típico de remediación). Sin orden es activación manual
  // pura → otorga cuota y días; CON orden, cuota y días los sumó ya el paso
  // anterior, así que aquí van en 0 para no acreditar el doble.
  const res = await upgradeProfileToPremium(sb, userId, {
    grantQuota: orderId ? 0 : PREMIUM_QUOTA,
    grantDays: orderId ? 0 : (grantDays ?? MEMBERSHIP_DAYS),
  });
  if (!res.ok) return { ok: false, error: res.error || "No se pudo activar Premium." };
  console.log(`[Admin] ✓ Membresía activada a mano para ${userId}${orderId ? ` (orden ${orderId})` : ""}.`);
  return { ok: true };
}

// ──────────────────────────────────────────────────
//  BILLETERAS DE CREADORES (Academia de Retos)
// ──────────────────────────────────────────────────

export interface AdminWalletMovimiento {
  id: string;
  creadorEmail: string;
  creadorNombre: string | null;
  retoTitulo: string;
  montoBruto: number;
  montoCreador: number;
  montoPlataforma: number;
  moneda: string;
  estado: "disponible" | "liquidado";
  fecha: string;
}

export interface AdminWalletCreador {
  creadorId: string;
  email: string;
  nombre: string | null;
  saldoDisponible: number;
  totalAcreditado: number;
  moneda: string;
  movimientos: AdminWalletMovimiento[];
  /** Datos bancarios de payout (SENSIBLES: solo se muestran aquí, al admin). */
  banca: { titular: string; documento: string; banco: string; tipoCuenta: string; numero: string } | null;
}

/** Wallets de todos los creadores con movimientos, agrupadas por creador. */
export async function adminListWallets(token: string): Promise<AdminWalletCreador[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  const { data: movs } = await sb
    .from("wallet_movimientos")
    .select("id, creador_id, reto_id, monto_bruto, monto_creador, monto_plataforma, moneda, estado, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (!movs?.length) return [];

  const creadorIds = [...new Set(movs.map(m => m.creador_id as string))];
  const retoIds = [...new Set(movs.map(m => m.reto_id as string))];
  const [{ data: profs }, { data: retos }, { data: bancas }] = await Promise.all([
    sb.from("profiles").select("id, email, username, display_name").in("id", creadorIds),
    sb.from("retos").select("id, titulo").in("id", retoIds),
    sb.from("creador_datos_bancarios").select("creador_id, titular, documento, banco, tipo_cuenta, numero").in("creador_id", creadorIds),
  ]);
  const profDe = new Map((profs || []).map(p => [p.id as string, p]));
  const tituloDe = new Map((retos || []).map(r => [r.id as string, r.titulo as string]));
  const bancaDe = new Map((bancas || []).map(b => [b.creador_id as string, b]));

  const porCreador = new Map<string, AdminWalletCreador>();
  for (const m of movs) {
    const cid = m.creador_id as string;
    if (!porCreador.has(cid)) {
      const prof = profDe.get(cid);
      const banca = bancaDe.get(cid);
      porCreador.set(cid, {
        creadorId: cid,
        email: (prof?.email as string) ?? "",
        nombre: (prof?.display_name as string) || (prof?.username as string) || null,
        saldoDisponible: 0,
        totalAcreditado: 0,
        moneda: (m.moneda as string) || "COP",
        movimientos: [],
        banca: banca
          ? {
              titular: (banca.titular as string) ?? "",
              documento: (banca.documento as string) ?? "",
              banco: (banca.banco as string) ?? "",
              tipoCuenta: (banca.tipo_cuenta as string) ?? "ahorros",
              numero: (banca.numero as string) ?? "",
            }
          : null,
      });
    }
    const w = porCreador.get(cid)!;
    const monto = Number(m.monto_creador);
    w.totalAcreditado += monto;
    if (m.estado === "disponible") w.saldoDisponible += monto;
    w.movimientos.push({
      id: m.id as string,
      creadorEmail: w.email,
      creadorNombre: w.nombre,
      retoTitulo: tituloDe.get(m.reto_id as string) ?? "Reto",
      montoBruto: Number(m.monto_bruto),
      montoCreador: monto,
      montoPlataforma: Number(m.monto_plataforma),
      moneda: (m.moneda as string) || "COP",
      estado: m.estado as AdminWalletMovimiento["estado"],
      fecha: m.created_at as string,
    });
  }
  return [...porCreador.values()].sort((a, b) => b.saldoDisponible - a.saldoDisponible);
}

/** Marca un movimiento como liquidado (payout manual hecho por fuera). */
export async function adminMarkMovimientoLiquidado(
  token: string,
  movimientoId: string,
  liquidado: boolean
): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("wallet_movimientos")
    .update(
      liquidado
        ? { estado: "liquidado", liquidado_at: new Date().toISOString() }
        : { estado: "disponible", liquidado_at: null }
    )
    .eq("id", movimientoId);
  if (error) {
    console.error("[Admin] no se pudo actualizar el movimiento:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Marca TODOS los movimientos disponibles de un creador como liquidados. */
export async function adminLiquidarCreador(token: string, creadorId: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin(token);
  if (!admin) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("wallet_movimientos")
    .update({ estado: "liquidado", liquidado_at: new Date().toISOString() })
    .eq("creador_id", creadorId)
    .eq("estado", "disponible");
  return { ok: !error };
}

// ──────────────────────────────────────────────────
//  MURO DE SESIONES — métricas de conversión
// ──────────────────────────────────────────────────

export interface GateMetrics {
  /** ¿Se corrió ya scripts/session-wall-setup.sql? */
  tablesReady: boolean;
  /** Tope de unidades por sesión vigente en el servidor. */
  budget: number;
  sessionsToday: number;
  locksToday: number;
  sessions30d: number;
  locks30d: number;
  /** Mediana de unidades consumidas por ventana (últimos 30 días). */
  medianUnits: number;
  /** Bloqueados ahora mismo (reloj corriendo). */
  lockedNow: number;
  /** Ventanas bloqueadas en 30d cuyo dueño pagó en las 48 h siguientes. */
  locksConvertedIn48h: number;
  /** % de conversión bloqueo → pago. */
  conversionPct: number;
  /** Unidades consumidas por modo (30 días). */
  byKind: { kind: string; units: number }[];
  membersActive: number;
  founders: number;
  expiringIn7d: number;
  lapsed: number;
}

/**
 * Métricas del muro. Agregados simples sobre study_sessions / study_units /
 * payment_orders: sirven para decidir si 5 unidades y 4 horas son los números
 * correctos, y para ver si el muro convierte de verdad.
 */
export async function adminGateMetrics(token: string): Promise<GateMetrics | null> {
  const admin = await requireAdmin(token);
  if (!admin) return null;
  const sb = supabaseAdmin();

  const empty: GateMetrics = {
    tablesReady: false, budget: SESSION_BUDGET, sessionsToday: 0, locksToday: 0,
    sessions30d: 0, locks30d: 0, medianUnits: 0, lockedNow: 0,
    locksConvertedIn48h: 0, conversionPct: 0, byKind: [],
    membersActive: 0, founders: 0, expiringIn7d: 0, lapsed: 0,
  };

  const probe = await sb.from("study_sessions").select("id", { count: "exact", head: true });
  if (probe.error) return empty;

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const d30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const in7d = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const nowIso = now.toISOString();

  // Ventanas de los últimos 30 días (con su dueño y si se bloquearon).
  const { data: sess } = await sb
    .from("study_sessions")
    .select("user_id, started_at, units_used, locked_at, locked_until")
    .gte("started_at", d30)
    .limit(5000);
  const rows = sess ?? [];

  const sessionsToday = rows.filter(r => new Date(r.started_at as string) >= startOfDay).length;
  const locked = rows.filter(r => r.locked_at);
  const locksToday = locked.filter(r => new Date(r.locked_at as string) >= startOfDay).length;
  const lockedNow = rows.filter(
    r => r.locked_until && new Date(r.locked_until as string) > now
  ).length;

  const units = rows.map(r => (r.units_used as number) ?? 0).sort((a, b) => a - b);
  const medianUnits = units.length
    ? units.length % 2
      ? units[(units.length - 1) / 2]
      : Math.round(((units[units.length / 2 - 1] + units[units.length / 2]) / 2) * 10) / 10
    : 0;

  // Bloqueo → pago en 48 h. Se cruza en memoria: son volúmenes pequeños y evita
  // depender de una vista o de un RPC nuevo solo para el panel.
  const { data: paid } = await sb
    .from("payment_orders")
    .select("user_id, paid_at")
    .eq("status", "paid")
    .gte("paid_at", d30)
    .limit(5000);
  const paysByUser = new Map<string, number[]>();
  for (const p of paid ?? []) {
    if (!p.paid_at) continue;
    const arr = paysByUser.get(p.user_id as string) ?? [];
    arr.push(new Date(p.paid_at as string).getTime());
    paysByUser.set(p.user_id as string, arr);
  }
  let locksConvertedIn48h = 0;
  for (const r of locked) {
    const t = new Date(r.locked_at as string).getTime();
    const pays = paysByUser.get(r.user_id as string);
    if (pays?.some(p => p >= t && p - t <= 48 * 3_600_000)) locksConvertedIn48h++;
  }

  // Unidades por modo.
  const { data: unitRows } = await sb
    .from("study_units")
    .select("kind")
    .gte("consumed_at", d30)
    .limit(20000);
  const kindMap = new Map<string, number>();
  for (const u of unitRows ?? []) {
    kindMap.set(u.kind as string, (kindMap.get(u.kind as string) ?? 0) + 1);
  }

  // Estado de las membresías.
  const [activeRes, foundersRes, expiringRes, lapsedRes] = await Promise.all([
    sb.from("profiles").select("id", { count: "exact", head: true })
      .eq("plan", "premium").gt("premium_until", nowIso),
    sb.from("profiles").select("id", { count: "exact", head: true }).eq("founder", true),
    sb.from("profiles").select("id", { count: "exact", head: true })
      .gt("premium_until", nowIso).lte("premium_until", in7d).eq("founder", false),
    sb.from("profiles").select("id", { count: "exact", head: true })
      .lte("premium_until", nowIso).eq("founder", false),
  ]);

  return {
    tablesReady: true,
    budget: SESSION_BUDGET,
    sessionsToday,
    locksToday,
    sessions30d: rows.length,
    locks30d: locked.length,
    medianUnits,
    lockedNow,
    locksConvertedIn48h,
    conversionPct: locked.length
      ? Math.round((locksConvertedIn48h / locked.length) * 1000) / 10
      : 0,
    byKind: [...kindMap.entries()]
      .map(([kind, u]) => ({ kind, units: u }))
      .sort((a, b) => b.units - a.units),
    membersActive: activeRes.count ?? 0,
    founders: foundersRes.count ?? 0,
    expiringIn7d: expiringRes.count ?? 0,
    lapsed: lapsedRes.count ?? 0,
  };
}
