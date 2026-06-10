"use server";

// Server actions de administración. Solo accesibles para perfiles con role='admin'.
// Permiten al admin regalar cuota de creación de rutas a cualquier usuario.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";

const AVATAR_BUCKET = "avatars";

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
}

export async function adminListUsers(token: string, search = ""): Promise<AdminUserRow[]> {
  const admin = await requireAdmin(token);
  if (!admin) return [];
  const sb = supabaseAdmin();

  let q = sb
    .from("profiles")
    .select("id, email, username, display_name, avatar_path, plan, role, route_quota, created_at")
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
  }));
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
