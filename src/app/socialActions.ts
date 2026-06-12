"use server";

// Server actions sociales: perfiles públicos, biblioteca/descubrimiento,
// seguir/guardar/calificar y ajustes de ruta (visibilidad, portada).
// Todas verifican el access token; el acceso a datos usa el service role.

import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { generateCoverImage } from "@/lib/generation";
import type {
  PlanState,
  PublicProfile,
  RouteCard,
  LibrarySection,
  FeaturedCreator,
  RouteLanding,
  RouteStudent,
  RouteVisibility,
  RouteCategory,
  Plan,
} from "@/lib/types";
import { ROUTE_CATEGORIES } from "@/lib/types";

const AVATAR_BUCKET = "avatars";
const COVER_BUCKET = "route-covers";

// ──────────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────────

function publicUrl(bucket: string, path: string | null): string | null {
  if (!path) return null;
  return supabaseAdmin().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Decodifica un string base64 (con o sin prefijo data URL) a Buffer + contentType. */
function decodeImage(base64: string): { buffer: Buffer; contentType: string } {
  let contentType = "image/png";
  let data = base64;
  const m = base64.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
  if (m) {
    contentType = m[1];
    data = m[2];
  }
  return { buffer: Buffer.from(data, "base64"), contentType };
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

interface RouteRow {
  id: string;
  topic: string;
  description: string | null;
  cover_path: string | null;
  visibility: string;
  category: string | null;
  rating_sum: number;
  rating_count: number;
  student_count: number;
  favorite_count: number;
  owner_id: string;
  created_at: string;
  status: string;
}

function rowCategory(category: string | null): RouteCategory {
  return (ROUTE_CATEGORIES.some(c => c.id === category) ? category : "otros") as RouteCategory;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
  graduates?: number;
}

function toRouteCard(r: RouteRow, creator?: ProfileRow): RouteCard {
  return {
    id: r.id,
    topic: r.topic,
    description: r.description,
    coverUrl: publicUrl(COVER_BUCKET, r.cover_path),
    visibility: (r.visibility as RouteVisibility) || "public",
    category: rowCategory(r.category),
    ratingAvg: r.rating_count ? Math.round((r.rating_sum / r.rating_count) * 10) / 10 : null,
    ratingCount: r.rating_count,
    studentCount: r.student_count,
    favoriteCount: r.favorite_count,
    creator: {
      username: creator?.username ?? null,
      displayName: creator?.display_name ?? null,
      avatarUrl: publicUrl(AVATAR_BUCKET, creator?.avatar_path ?? null),
      graduates: creator?.graduates ?? 0,
    },
  };
}

const ROUTE_CARD_COLS =
  "id, topic, description, cover_path, visibility, category, rating_sum, rating_count, student_count, favorite_count, owner_id, created_at, status";

// ──────────────────────────────────────────────────
//  PLAN / PERFIL PROPIO
// ──────────────────────────────────────────────────

export async function getPlan(token: string): Promise<PlanState | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const { data: profile } = await sb
    .from("profiles")
    .select("plan, route_quota, premium_since, batch_enabled")
    .eq("id", user.id)
    .single();
  const { count } = await sb
    .from("routes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);
  return {
    plan: (profile?.plan as Plan) || "free",
    routeQuota: profile?.route_quota ?? 1,
    routesUsed: count ?? 0,
    premiumSince: profile?.premium_since ?? null,
    batchEnabled: Boolean(profile?.batch_enabled),
  };
}

/** Perfil del usuario autenticado (para ajustes y onboarding). */
export async function getMyProfile(token: string): Promise<{
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  email: string;
  profilePublic: boolean;
} | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const { data: p } = await sb
    .from("profiles")
    .select("username, display_name, bio, avatar_path, banner_path, profile_public")
    .eq("id", user.id)
    .single();
  return {
    id: user.id,
    username: p?.username ?? null,
    displayName: p?.display_name ?? null,
    bio: p?.bio ?? null,
    avatarUrl: publicUrl(AVATAR_BUCKET, p?.avatar_path ?? null),
    bannerUrl: publicUrl(AVATAR_BUCKET, p?.banner_path ?? null),
    email: user.email,
    profilePublic: p?.profile_public !== false,
  };
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export async function updateProfile(
  token: string,
  input: { username?: string; displayName?: string; bio?: string; profilePublic?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };
  const sb = supabaseAdmin();

  const patch: Record<string, unknown> = {};

  if (input.username !== undefined) {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      return { ok: false, error: "El usuario debe tener 3-20 caracteres: letras, números o guion bajo." };
    }
    // Unicidad (excluyendo al propio usuario)
    const { data: taken } = await sb
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", user.id)
      .maybeSingle();
    if (taken) return { ok: false, error: "Ese nombre de usuario ya está en uso." };
    patch.username = username;
  }

  if (input.displayName !== undefined) patch.display_name = input.displayName.trim().slice(0, 60) || null;
  if (input.bio !== undefined) patch.bio = input.bio.trim().slice(0, 280) || null;
  if (input.profilePublic !== undefined) patch.profile_public = Boolean(input.profilePublic);

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await sb.from("profiles").update(patch).eq("id", user.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ese nombre de usuario ya está en uso." };
    return { ok: false, error: "No se pudo actualizar el perfil." };
  }
  return { ok: true };
}

export async function uploadProfileImage(
  token: string,
  kind: "avatar" | "banner",
  base64: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión inválida" };

  const { buffer, contentType } = decodeImage(base64);
  if (buffer.length === 0) return { ok: false, error: "Imagen vacía." };
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, error: "La imagen supera el límite de 8 MB." };

  const sb = supabaseAdmin();
  const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const path = `${user.id}/${kind}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(AVATAR_BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) return { ok: false, error: "No se pudo subir la imagen." };

  const col = kind === "avatar" ? "avatar_path" : "banner_path";
  await sb.from("profiles").update({ [col]: path }).eq("id", user.id);
  return { ok: true, url: publicUrl(AVATAR_BUCKET, path) ?? undefined };
}

// ──────────────────────────────────────────────────
//  PERFIL PÚBLICO
// ──────────────────────────────────────────────────

export async function getProfileByUsername(token: string, username: string): Promise<PublicProfile | null> {
  const viewer = await getUserFromToken(token);
  const sb = supabaseAdmin();

  const { data: profile } = await sb
    .from("profiles")
    .select("id, username, display_name, bio, avatar_path, banner_path, plan, profile_public, routes_completed, avg_stars, graduates")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (!profile) return null;

  const isOwner = viewer?.id === profile.id;
  const profilePublic = profile.profile_public !== false;

  // Perfil privado y no es el dueño: vista mínima (identidad + rangos),
  // sin rutas ni stats detalladas.
  if (!profilePublic && !isOwner) {
    return {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      bio: null,
      avatarUrl: publicUrl(AVATAR_BUCKET, profile.avatar_path),
      bannerUrl: null,
      plan: (profile.plan as Plan) || "free",
      isOwner: false,
      isFollowing: false,
      profilePublic: false,
      stats: {
        routeCount: 0,
        studentTotal: 0,
        ratingAvg: null,
        followers: 0,
        following: 0,
        routesCompleted: profile.routes_completed ?? 0,
        avgStars: profile.avg_stars ?? 0,
        graduates: profile.graduates ?? 0,
      },
      routes: [],
    };
  }

  // Rutas: públicas para todos; si es el dueño, también las privadas.
  // Las que están fuera del aire (blocked) no aparecen para nadie.
  let routesQuery = sb.from("routes").select(ROUTE_CARD_COLS).eq("owner_id", profile.id).eq("blocked", false).order("created_at", { ascending: false });
  if (!isOwner) routesQuery = routesQuery.eq("visibility", "public");
  const { data: routeRows } = await routesQuery;
  const routes = (routeRows || []).map(r => toRouteCard(r as RouteRow, profile as ProfileRow));

  // Stats
  const publicRoutes = (routeRows || []).filter(r => r.visibility === "public");
  const studentTotal = publicRoutes.reduce((s, r) => s + (r.student_count || 0), 0);
  const ratingSum = publicRoutes.reduce((s, r) => s + (r.rating_sum || 0), 0);
  const ratingCount = publicRoutes.reduce((s, r) => s + (r.rating_count || 0), 0);

  const [{ count: followers }, { count: following }, { data: isFollowingRow }] = await Promise.all([
    sb.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", profile.id),
    sb.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", profile.id),
    viewer && !isOwner
      ? sb.from("follows").select("follower_id").eq("follower_id", viewer.id).eq("following_id", profile.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    bio: profile.bio,
    avatarUrl: publicUrl(AVATAR_BUCKET, profile.avatar_path),
    bannerUrl: publicUrl(AVATAR_BUCKET, profile.banner_path),
    plan: (profile.plan as Plan) || "free",
    isOwner,
    isFollowing: Boolean(isFollowingRow),
    profilePublic,
    stats: {
      routeCount: publicRoutes.length,
      studentTotal,
      ratingAvg: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
      followers: followers ?? 0,
      following: following ?? 0,
      routesCompleted: profile.routes_completed ?? 0,
      avgStars: profile.avg_stars ?? 0,
      graduates: profile.graduates ?? 0,
    },
    routes,
  };
}

// ──────────────────────────────────────────────────
//  BIBLIOTECA / DESCUBRIMIENTO
// ──────────────────────────────────────────────────

async function fetchCreators(ownerIds: string[]): Promise<Map<string, ProfileRow>> {
  const sb = supabaseAdmin();
  if (ownerIds.length === 0) return new Map();
  const { data } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_path, graduates")
    .in("id", ownerIds);
  return new Map((data || []).map(p => [p.id, p as ProfileRow]));
}

/**
 * Biblioteca pública organizada POR CATEGORÍAS (en el orden fijo de
 * ROUTE_CATEGORIES). Las categorías sin rutas no se muestran. Una fila
 * "Destacadas" va primero cuando hay tracción real.
 */
export async function getLibrary(token: string): Promise<LibrarySection[]> {
  await getUserFromToken(token); // requiere sesión, pero la biblioteca es común
  const sb = supabaseAdmin();

  const { data: pool } = await sb
    .from("routes")
    .select(ROUTE_CARD_COLS)
    .eq("visibility", "public")
    .eq("blocked", false)
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (pool || []) as RouteRow[];
  if (rows.length === 0) return [];

  const creators = await fetchCreators([...new Set(rows.map(r => r.owner_id))]);
  const card = (r: RouteRow) => toRouteCard(r, creators.get(r.owner_id));

  const sections: LibrarySection[] = [];

  // Destacadas globales (solo si alguna ruta tiene tracción)
  const destacadas = [...rows]
    .sort((a, b) => (b.student_count - a.student_count) || (b.rating_sum - a.rating_sum))
    .slice(0, 12);
  if (destacadas.some(r => r.student_count > 0 || r.rating_count > 0)) {
    sections.push({ key: "destacadas", title: "⭐ Destacadas", routes: destacadas.map(card) });
  }

  // Una fila por categoría (orden fijo, vacías ocultas), populares primero
  for (const cat of ROUTE_CATEGORIES) {
    const inCat = rows
      .filter(r => rowCategory(r.category) === cat.id)
      .sort((a, b) => (b.student_count - a.student_count) || (b.favorite_count - a.favorite_count))
      .slice(0, 16);
    if (inCat.length > 0) {
      sections.push({ key: cat.id, title: cat.label, routes: inCat.map(card) });
    }
  }

  return sections;
}

export async function searchPublicRoutes(token: string, q: string): Promise<RouteCard[]> {
  await getUserFromToken(token);
  const term = q.trim();
  if (!term) return [];
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("routes")
    .select(ROUTE_CARD_COLS)
    .eq("visibility", "public")
    .eq("blocked", false)
    .or(`topic.ilike.%${term}%,description.ilike.%${term}%`)
    .order("student_count", { ascending: false })
    .limit(30);
  const rows = (data || []) as RouteRow[];
  const creators = await fetchCreators([...new Set(rows.map(r => r.owner_id))]);
  return rows.map(r => toRouteCard(r, creators.get(r.owner_id)));
}

export async function getFeaturedCreators(token: string): Promise<FeaturedCreator[]> {
  await getUserFromToken(token);
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("routes")
    .select("owner_id, student_count")
    .eq("visibility", "public")
    .eq("blocked", false);
  const agg = new Map<string, { routeCount: number; studentTotal: number }>();
  for (const r of data || []) {
    const cur = agg.get(r.owner_id) || { routeCount: 0, studentTotal: 0 };
    cur.routeCount += 1;
    cur.studentTotal += r.student_count || 0;
    agg.set(r.owner_id, cur);
  }
  const topIds = [...agg.entries()]
    .sort((a, b) => (b[1].studentTotal - a[1].studentTotal) || (b[1].routeCount - a[1].routeCount))
    .slice(0, 12)
    .map(([id]) => id);
  if (topIds.length === 0) return [];
  const creators = await fetchCreators(topIds);
  return topIds
    .map(id => {
      const c = creators.get(id);
      const a = agg.get(id)!;
      if (!c?.username) return null; // solo creadores con handle
      return {
        username: c.username,
        displayName: c.display_name,
        avatarUrl: publicUrl(AVATAR_BUCKET, c.avatar_path),
        routeCount: a.routeCount,
        studentTotal: a.studentTotal,
        graduates: c.graduates ?? 0,
      } as FeaturedCreator;
    })
    .filter((c): c is FeaturedCreator => c !== null);
}

export async function getMyFavorites(token: string): Promise<RouteCard[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];
  const sb = supabaseAdmin();
  const { data: favs } = await sb.from("favorites").select("route_id").eq("user_id", user.id);
  const ids = (favs || []).map(f => f.route_id);
  if (ids.length === 0) return [];
  const { data: rows } = await sb.from("routes").select(ROUTE_CARD_COLS).in("id", ids);
  const list = (rows || []) as RouteRow[];
  const creators = await fetchCreators([...new Set(list.map(r => r.owner_id))]);
  return list.map(r => toRouteCard(r, creators.get(r.owner_id)));
}

// ──────────────────────────────────────────────────
//  FICHA DE RUTA (LANDING)
// ──────────────────────────────────────────────────

/**
 * Ficha pública de una ruta. `token` puede ser null: los visitantes anónimos
 * (links compartidos en redes) ven la landing de rutas públicas; solo al dar
 * "Estudiar" se les pide registro.
 */
export async function getRouteLanding(token: string | null, routeId: string): Promise<RouteLanding | null> {
  const user = token ? await getUserFromToken(token) : null;
  const sb = supabaseAdmin();

  const { data: r } = await sb
    .from("routes")
    .select(
      "id, topic, description, cover_path, cover_prompt, visibility, blocked, category, rating_sum, rating_count, student_count, favorite_count, owner_id, created_at, status"
    )
    .eq("id", routeId)
    .maybeSingle();
  if (!r) return null;
  if (r.blocked) return null; // ruta fuera del aire por el admin
  const isOwner = user ? r.owner_id === user.id : false;
  if (!isOwner && r.visibility !== "public") return null;

  const [{ data: creator }, { count: totalNodes }, myRatingRow, myFavRow, { data: passedAttempts }] =
    await Promise.all([
      sb.from("profiles").select("id, username, display_name, avatar_path, graduates").eq("id", r.owner_id).single(),
      sb.from("lessons").select("id", { count: "exact", head: true }).eq("route_id", routeId),
      user
        ? sb.from("route_ratings").select("stars").eq("route_id", routeId).eq("user_id", user.id).maybeSingle().then(res => res.data)
        : Promise.resolve(null),
      user
        ? sb.from("favorites").select("route_id").eq("route_id", routeId).eq("user_id", user.id).maybeSingle().then(res => res.data)
        : Promise.resolve(null),
      sb.from("attempts").select("user_id, node_id").eq("route_id", routeId).eq("passed", true),
    ]);

  const total = totalNodes ?? 0;

  // Completado por estudiante (nodos distintos aprobados / total)
  const perUser = new Map<string, Set<string>>();
  for (const a of passedAttempts || []) {
    if (!perUser.has(a.user_id)) perUser.set(a.user_id, new Set());
    perUser.get(a.user_id)!.add(a.node_id);
  }
  let completionAvg: number | null = null;
  if (total > 0 && perUser.size > 0) {
    const ratios = [...perUser.values()].map(s => Math.min(1, s.size / total));
    completionAvg = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100);
  }
  const myCompletedNodes = user ? (perUser.get(user.id)?.size ?? 0) : 0;

  return {
    id: r.id,
    topic: r.topic,
    description: r.description,
    coverUrl: publicUrl(COVER_BUCKET, r.cover_path),
    visibility: (r.visibility as RouteVisibility) || "public",
    category: rowCategory(r.category),
    coverPrompt: r.cover_prompt ?? null,
    ratingAvg: r.rating_count ? Math.round((r.rating_sum / r.rating_count) * 10) / 10 : null,
    ratingCount: r.rating_count,
    studentCount: r.student_count,
    favoriteCount: r.favorite_count,
    completionAvg,
    totalNodes: total,
    creator: {
      id: r.owner_id,
      username: creator?.username ?? null,
      displayName: creator?.display_name ?? null,
      avatarUrl: publicUrl(AVATAR_BUCKET, creator?.avatar_path ?? null),
      graduates: creator?.graduates ?? 0,
    },
    myRating: myRatingRow?.stars ?? null,
    isFavorite: Boolean(myFavRow),
    isOwner,
    myCompletedNodes,
  };
}

/**
 * Estudiantes de una ruta (para la ficha). Privacidad:
 * - El DUEÑO de la ruta ve a todos sus estudiantes con identidad y link.
 * - Otros viewers ven con identidad solo a los de perfil público; los privados
 *   aparecen como "Explorador anónimo" (solo % y rango).
 * El propio creador no se lista como estudiante de su ruta.
 */
export async function getRouteStudents(token: string | null, routeId: string): Promise<RouteStudent[]> {
  const viewer = token ? await getUserFromToken(token) : null;
  const sb = supabaseAdmin();

  const { data: route } = await sb
    .from("routes")
    .select("owner_id, visibility, blocked")
    .eq("id", routeId)
    .maybeSingle();
  if (!route || route.blocked) return [];
  const isRouteOwner = viewer?.id === route.owner_id;
  if (!isRouteOwner && route.visibility !== "public") return [];

  const [{ count: totalLessons }, { data: passed }] = await Promise.all([
    sb.from("lessons").select("id", { count: "exact", head: true }).eq("route_id", routeId),
    sb.from("attempts").select("user_id, node_id, stars").eq("route_id", routeId).eq("passed", true),
  ]);
  const total = totalLessons ?? 0;
  if (total === 0 || !passed?.length) return [];

  // Mejor estrella por nodo y nodos completados, por estudiante
  const byUser = new Map<string, Map<string, number>>();
  for (const a of passed) {
    if (a.user_id === route.owner_id) continue; // el creador no es su propio estudiante
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, new Map());
    const nodes = byUser.get(a.user_id)!;
    nodes.set(a.node_id, Math.max(nodes.get(a.node_id) ?? 0, a.stars));
  }
  if (byUser.size === 0) return [];

  const ranked = [...byUser.entries()]
    .map(([userId, nodes]) => {
      const bests = [...nodes.values()];
      return {
        userId,
        completionPct: Math.min(100, Math.round((nodes.size / total) * 100)),
        avgStars: bests.length ? Math.round((bests.reduce((a, b) => a + b, 0) / bests.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => (b.completionPct - a.completionPct) || ((b.avgStars ?? 0) - (a.avgStars ?? 0)))
    .slice(0, 50);

  const { data: profiles } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_path, profile_public, routes_completed, avg_stars")
    .in("id", ranked.map(r => r.userId));
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  return ranked.map(r => {
    const p = profileMap.get(r.userId);
    // El dueño de la ruta ve a todos; otros solo a los perfiles públicos
    const anonymous = !p || (p.profile_public === false && !isRouteOwner);
    return {
      username: anonymous ? null : (p?.username ?? null),
      displayName: anonymous ? null : (p?.display_name ?? null),
      avatarUrl: anonymous ? null : publicUrl(AVATAR_BUCKET, p?.avatar_path ?? null),
      anonymous,
      completionPct: r.completionPct,
      avgStars: r.avgStars,
      routesCompleted: p?.routes_completed ?? 0,
      explorerAvgStars: p?.avg_stars ?? 0,
    };
  });
}

// ──────────────────────────────────────────────────
//  ACCIONES SOCIALES
// ──────────────────────────────────────────────────

export async function rateRoute(token: string, routeId: string, stars: number): Promise<{ ok: boolean; ratingAvg: number | null; ratingCount: number }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, ratingAvg: null, ratingCount: 0 };
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  const sb = supabaseAdmin();

  await sb.from("route_ratings").upsert(
    { user_id: user.id, route_id: routeId, stars: s },
    { onConflict: "user_id,route_id" }
  );

  // Recomputar agregados desde la fuente (sin drift)
  const { data: all } = await sb.from("route_ratings").select("stars").eq("route_id", routeId);
  const ratingCount = all?.length ?? 0;
  const ratingSum = (all || []).reduce((acc, row) => acc + row.stars, 0);
  await sb.from("routes").update({ rating_sum: ratingSum, rating_count: ratingCount }).eq("id", routeId);

  return { ok: true, ratingAvg: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null, ratingCount };
}

export async function toggleFavorite(token: string, routeId: string): Promise<{ ok: boolean; isFavorite: boolean; favoriteCount: number }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, isFavorite: false, favoriteCount: 0 };
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("favorites")
    .select("route_id")
    .eq("user_id", user.id)
    .eq("route_id", routeId)
    .maybeSingle();

  let isFavorite: boolean;
  if (existing) {
    await sb.from("favorites").delete().eq("user_id", user.id).eq("route_id", routeId);
    isFavorite = false;
  } else {
    await sb.from("favorites").insert({ user_id: user.id, route_id: routeId });
    isFavorite = true;
  }

  const { count } = await sb.from("favorites").select("route_id", { count: "exact", head: true }).eq("route_id", routeId);
  const favoriteCount = count ?? 0;
  await sb.from("routes").update({ favorite_count: favoriteCount }).eq("id", routeId);

  return { ok: true, isFavorite, favoriteCount };
}

export async function toggleFollow(token: string, targetUserId: string): Promise<{ ok: boolean; isFollowing: boolean }> {
  const user = await getUserFromToken(token);
  if (!user || user.id === targetUserId) return { ok: false, isFollowing: false };
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("follows")
    .select("follower_id")
    .eq("follower_id", user.id)
    .eq("following_id", targetUserId)
    .maybeSingle();

  if (existing) {
    await sb.from("follows").delete().eq("follower_id", user.id).eq("following_id", targetUserId);
    return { ok: true, isFollowing: false };
  }
  await sb.from("follows").insert({ follower_id: user.id, following_id: targetUserId });
  return { ok: true, isFollowing: true };
}

// ──────────────────────────────────────────────────
//  AJUSTES DE RUTA (solo dueño)
// ──────────────────────────────────────────────────

async function assertOwner(token: string, routeId: string): Promise<{ ownerId: string; topic: string; sintesis: unknown } | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = supabaseAdmin();
  const { data: route } = await sb.from("routes").select("owner_id, topic, sintesis").eq("id", routeId).single();
  if (!route || route.owner_id !== user.id) return null;
  return { ownerId: route.owner_id, topic: route.topic, sintesis: route.sintesis };
}

export async function setRouteVisibility(token: string, routeId: string, visibility: RouteVisibility): Promise<{ ok: boolean }> {
  const owner = await assertOwner(token, routeId);
  if (!owner) return { ok: false };
  await supabaseAdmin().from("routes").update({ visibility }).eq("id", routeId);
  return { ok: true };
}

/** El creador edita la info de la ficha: título y descripción. */
export async function updateRouteInfo(
  token: string,
  routeId: string,
  info: { topic?: string; description?: string }
): Promise<{ ok: boolean; error?: string }> {
  const owner = await assertOwner(token, routeId);
  if (!owner) return { ok: false, error: "Solo el creador puede editar la ruta." };

  const patch: { topic?: string; description?: string | null } = {};
  if (info.topic !== undefined) {
    const t = info.topic.trim().slice(0, 140);
    if (!t) return { ok: false, error: "El título no puede quedar vacío." };
    patch.topic = t;
  }
  if (info.description !== undefined) {
    patch.description = info.description.trim().slice(0, 400) || null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabaseAdmin().from("routes").update(patch).eq("id", routeId);
  if (error) return { ok: false, error: "No se pudo guardar la información." };
  return { ok: true };
}

/**
 * Regenera la portada con IA a partir de un prompt del usuario (síncrono:
 * devuelve la URL nueva). Acepta una imagen de referencia opcional (base64,
 * con o sin prefijo data URL) — p. ej., la foto del autor para integrarla.
 */
export async function generateRouteCover(
  token: string,
  routeId: string,
  prompt: string,
  referenceBase64?: string
): Promise<{ ok: boolean; coverUrl?: string; error?: string }> {
  const owner = await assertOwner(token, routeId);
  if (!owner) return { ok: false, error: "No autorizado" };

  let references: Array<{ mimeType: string; data: string }> = [];
  let finalPrompt = prompt.trim().slice(0, 600);
  if (referenceBase64) {
    const { buffer, contentType } = decodeImage(referenceBase64);
    if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, error: "La imagen de referencia supera el límite de 8 MB." };
    if (buffer.length > 0) {
      references = [{ mimeType: contentType, data: buffer.toString("base64") }];
      finalPrompt += "\n\nUsa la imagen adjunta como referencia e intégrala de forma elegante y protagonista en la portada (por ejemplo, si es la foto del autor, que aparezca bien integrado en la composición).";
    }
  }

  const img = await generateCoverImage(finalPrompt, references);
  if (!img) return { ok: false, error: "No se pudo generar la portada. Inténtalo de nuevo." };

  const sb = supabaseAdmin();
  const path = `${routeId}/cover-${Date.now()}.png`;
  const { error } = await sb.storage.from(COVER_BUCKET).upload(path, img, { contentType: "image/png", upsert: true });
  if (error) return { ok: false, error: "No se pudo guardar la portada." };

  await sb.from("routes").update({ cover_path: path, cover_prompt: prompt }).eq("id", routeId);
  return { ok: true, coverUrl: publicUrl(COVER_BUCKET, path) ?? undefined };
}

export async function uploadRouteCover(token: string, routeId: string, base64: string): Promise<{ ok: boolean; coverUrl?: string; error?: string }> {
  const owner = await assertOwner(token, routeId);
  if (!owner) return { ok: false, error: "No autorizado" };

  const { buffer, contentType } = decodeImage(base64);
  if (buffer.length === 0) return { ok: false, error: "Imagen vacía." };
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, error: "La imagen supera el límite de 8 MB." };

  const sb = supabaseAdmin();
  const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const path = `${routeId}/cover-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(COVER_BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) return { ok: false, error: "No se pudo subir la portada." };

  await sb.from("routes").update({ cover_path: path, cover_prompt: null }).eq("id", routeId);
  return { ok: true, coverUrl: publicUrl(COVER_BUCKET, path) ?? undefined };
}
