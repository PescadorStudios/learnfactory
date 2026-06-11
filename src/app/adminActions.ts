"use server";

// Server actions de administración. Solo accesibles para perfiles con role='admin'.
// Permiten al admin regalar cuota de creación de rutas a cualquier usuario.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { categoryLabel } from "@/lib/types";

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
}

export async function adminListUsers(token: string, search = ""): Promise<AdminUserRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  let q = sb
    .from("profiles")
    .select("id, email, username, display_name, avatar_path, plan, role, route_quota, batch_enabled, created_at")
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
