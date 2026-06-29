"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Play, Users, Star, Heart, BarChart3, BookOpen, Globe, Lock, ImageIcon, AlertTriangle, Trash2, Tag, X, Share2, Check, Pencil, GraduationCap, EyeOff, Film, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { getRouteLanding, rateRoute, toggleFavorite, setRouteVisibility, updateRouteInfo, getRouteStudents } from "@/app/socialActions";
import { setRouteCategory, deleteRoute } from "@/app/routeActions";
import { generarVideosRuta, getScrollJobStatus, integrarCortos } from "@/app/scrollActions";
import { ROUTE_CATEGORIES, categoryLabel, type RouteLanding, type RouteStudent } from "@/lib/types";
import { explorerRank, creatorRank as creatorRankOf } from "@/lib/reputation";
import { trackMeta } from "@/lib/meta/pixel";
import AppHeader from "@/components/AppHeader";
import StarRating from "@/components/StarRating";
import CoverEditor from "@/components/CoverEditor";
import { RankPill } from "@/components/ReputationBadge";

export default function RouteLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  // La ficha es pública: los visitantes anónimos (links de redes) pueden verla.
  const { token, loading, session } = useAuth();
  const [data, setData] = useState<RouteLanding | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editingCover, setEditingCover] = useState(false);
  const [students, setStudents] = useState<RouteStudent[] | null>(null);

  // estado local optimista
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [ratingAvg, setRatingAvg] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [category, setCategory] = useState<string>("otros");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  // Modo Scroll: estado de los cortos (solo dueño)
  const [videosEstado, setVideosEstado] = useState<RouteLanding["videosEstado"]>("sin_videos");
  const [genVideos, setGenVideos] = useState(false);
  const [genError, setGenError] = useState("");
  const [jobProgress, setJobProgress] = useState<{ total: number; completed: number } | null>(null);
  const [cortosIntegrados, setCortosIntegrados] = useState(false);
  const [integrating, setIntegrating] = useState(false);

  // edición de info (solo dueño)
  const [editingInfo, setEditingInfo] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState("");

  useEffect(() => {
    if (loading) return;
    getRouteLanding(token, id).then(d => {
      if (!d) { setNotFound(true); return; }
      setData(d);
      setCoverUrl(d.coverUrl);
      setIsFavorite(d.isFavorite);
      setFavoriteCount(d.favoriteCount);
      setMyRating(d.myRating);
      setRatingAvg(d.ratingAvg);
      setRatingCount(d.ratingCount);
      setVisibility(d.visibility);
      setCategory(d.category);
      setTopicDraft(d.topic);
      setDescDraft(d.description || "");
      setVideosEstado(d.videosEstado);
      setCortosIntegrados(d.cortosIntegrados);
    });
    getRouteStudents(token, id).then(setStudents);
  }, [token, id, loading]);

  // Mientras los cortos se generan, sondear el progreso del job.
  useEffect(() => {
    if (!token || videosEstado !== "generando") return;
    let active = true;
    const tick = async () => {
      const st = await getScrollJobStatus(token, id);
      if (!active || !st) return;
      setJobProgress({ total: st.total, completed: st.completed });
      if (st.estado !== "generando") setVideosEstado(st.estado);
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { active = false; clearInterval(iv); };
  }, [token, id, videosEstado]);

  // Acciones que requieren cuenta: el anónimo va a registrarse y vuelve aquí
  const requireLogin = (next: string) => {
    router.push(`/login?mode=signup&next=${encodeURIComponent(next)}`);
  };

  const handleStudy = () => {
    const dest = `/tree?route=${id}`;
    // Evento de funnel: clic en "Estudiar" (intención). El usuario puede ser
    // anónimo (llega del anuncio) → el match se hace con fbp/fbc/IP/UA.
    trackMeta("Lead", {
      email: session?.user?.email,
      externalId: session?.user?.id,
      customData: { content_name: data?.topic, content_ids: [id], content_type: "route" },
    });
    if (!session) { requireLogin(dest); return; }
    router.push(dest);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/route/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback: compartir nativo en móvil
      if (navigator.share) navigator.share({ title: data?.topic, url }).catch(() => {});
    }
  };

  const handleRate = async (stars: number) => {
    if (!token) { requireLogin(`/route/${id}`); return; }
    setMyRating(stars);
    const res = await rateRoute(token, id, stars);
    if (res.ok) { setRatingAvg(res.ratingAvg); setRatingCount(res.ratingCount); }
  };

  const handleFavorite = async () => {
    if (!token) { requireLogin(`/route/${id}`); return; }
    setIsFavorite(f => !f);
    const res = await toggleFavorite(token, id);
    if (res.ok) { setIsFavorite(res.isFavorite); setFavoriteCount(res.favoriteCount); }
  };

  const handleSaveInfo = async () => {
    if (!token || savingInfo) return;
    setSavingInfo(true);
    setInfoError("");
    const res = await updateRouteInfo(token, id, { topic: topicDraft, description: descDraft });
    setSavingInfo(false);
    if (res.ok) {
      setData(d => (d ? { ...d, topic: topicDraft.trim(), description: descDraft.trim() || null } : d));
      setEditingInfo(false);
    } else {
      setInfoError(res.error || "No se pudo guardar.");
    }
  };

  const handleVisibility = async (v: "public" | "private") => {
    if (!token) return;
    setVisibility(v);
    await setRouteVisibility(token, id, v);
  };

  const handleCategory = async (cat: string) => {
    if (!token) return;
    setCategory(cat);
    await setRouteCategory(token, id, cat);
  };

  const handleGenerarVideos = async () => {
    if (!token || genVideos) return;
    setGenVideos(true);
    setGenError("");
    const res = await generarVideosRuta(token, id);
    setGenVideos(false);
    if (res.ok) {
      setVideosEstado("generando");
      setJobProgress(null);
    } else if (res.quotaReached) {
      setGenError("Te quedaste sin créditos para generar los videos de esta ruta.");
    } else {
      setGenError(res.error || "No se pudo iniciar la generación.");
    }
  };

  const handleIntegrarCortos = async (integrar: boolean) => {
    if (!token || integrating) return;
    setIntegrating(true);
    setGenError("");
    const res = await integrarCortos(token, id, integrar);
    setIntegrating(false);
    if (res.ok) setCortosIntegrados(integrar);
    else setGenError(res.error || "No se pudo integrar.");
  };

  const handleRegenerarVideos = async () => {
    if (!token || genVideos) return;
    setGenVideos(true);
    setGenError("");
    const res = await generarVideosRuta(token, id, { regenerar: true });
    setGenVideos(false);
    if (res.ok) {
      setVideosEstado("generando");
      setJobProgress(null);
    } else {
      setGenError(res.error || "No se pudo regenerar.");
    }
  };

  const handleDelete = async () => {
    if (!token || deleting) return;
    setDeleting(true);
    setDeleteError("");
    const res = await deleteRoute(token, id);
    if (res.ok) {
      router.push("/");
    } else {
      setDeleteError(res.error || "No se pudo eliminar la ruta.");
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>;
  }

  if (notFound) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <AppHeader />
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Ruta no disponible</h1>
          <p className="text-zinc-500 mb-4">Puede ser privada o no existir.</p>
          <button onClick={() => router.push("/")} className="px-6 py-3 rounded-2xl bg-primary text-white font-bold">Explorar biblioteca</button>
        </div>
      </main>
    );
  }

  if (!data) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>;
  }

  const progressPct = data.totalNodes > 0 ? Math.round((data.myCompletedNodes / data.totalNodes) * 100) : 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AppHeader />

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid md:grid-cols-5 gap-8">
          {/* Portada */}
          <div className="md:col-span-2">
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt={data.topic} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/20">
                  <BookOpen className="w-10 h-10 text-zinc-600" />
                </div>
              )}
            </div>
            {data.isOwner && (
              <button
                onClick={() => setEditingCover(true)}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-zinc-900 border border-zinc-800 hover:border-primary text-zinc-300 rounded-xl py-2.5 text-sm font-medium transition-all"
              >
                <ImageIcon className="w-4 h-4" /> Cambiar portada
              </button>
            )}
          </div>

          {/* Info */}
          <div className="md:col-span-3">
            {editingInfo ? (
              <div className="mb-5 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
                <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold">Título</label>
                <input
                  value={topicDraft}
                  onChange={e => setTopicDraft(e.target.value)}
                  maxLength={140}
                  className="w-full mt-1 mb-3 bg-zinc-950 border border-zinc-800 rounded-xl py-2.5 px-3.5 text-lg font-bold text-white focus:outline-none focus:border-primary"
                />
                <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold">Descripción</label>
                <textarea
                  value={descDraft}
                  onChange={e => setDescDraft(e.target.value)}
                  rows={4}
                  maxLength={400}
                  placeholder="¿Qué va a aprender quien tome esta ruta? ¿Para quién es?"
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-xl py-2.5 px-3.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
                />
                <p className="text-right text-[11px] text-zinc-600 mt-0.5">{descDraft.length}/400</p>
                {infoError && <p className="text-rose-400 text-sm mb-2">{infoError}</p>}
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={handleSaveInfo}
                    disabled={savingInfo}
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-xl px-5 py-2 text-sm font-bold transition-all disabled:opacity-60"
                  >
                    {savingInfo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
                  </button>
                  <button
                    onClick={() => { setEditingInfo(false); setTopicDraft(data.topic); setDescDraft(data.description || ""); setInfoError(""); }}
                    disabled={savingInfo}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-bold hover:bg-zinc-700 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 mb-3">
                <h1 className="text-3xl md:text-4xl font-bold">{data.topic}</h1>
                {data.isOwner && (
                  <button
                    onClick={() => setEditingInfo(true)}
                    title="Editar título y descripción"
                    className="shrink-0 mt-1.5 w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-primary text-zinc-400 hover:text-white flex items-center justify-center transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => data.creator.username && router.push(`/u/${data.creator.username}`)}
              className="inline-flex items-center gap-2 mb-4 group"
            >
              <div className="w-7 h-7 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center">
                {data.creator.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.creator.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-zinc-500">{(data.creator.displayName || data.creator.username || "?")[0]?.toUpperCase()}</span>
                )}
              </div>
              <span className="text-zinc-400 text-sm group-hover:text-white transition-colors">
                {data.creator.displayName || `@${data.creator.username}`}
              </span>
              <RankPill track="creator" rank={creatorRankOf(data.creator.graduates)} size="xs" />
            </button>

            {!editingInfo && data.description && <p className="text-zinc-300 mb-5 leading-relaxed">{data.description}</p>}

            {/* Métricas */}
            <div className="flex flex-wrap gap-4 mb-6 text-sm">
              <span className="flex items-center gap-1.5 text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-full px-3 py-1 text-xs font-bold">
                <Tag className="w-3.5 h-3.5" /> {categoryLabel(category)}
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <Star className="w-4 h-4 fill-current" /> {ratingAvg ?? "—"} <span className="text-zinc-600">({ratingCount})</span>
              </span>
              <span className="flex items-center gap-1.5 text-zinc-300"><Users className="w-4 h-4 text-secondary" /> {data.studentCount} estudiantes</span>
              <span className="flex items-center gap-1.5 text-zinc-300"><BarChart3 className="w-4 h-4 text-primary" /> {data.completionAvg ?? 0}% finalización</span>
              <span className="flex items-center gap-1.5 text-zinc-300"><BookOpen className="w-4 h-4 text-zinc-400" /> {data.totalNodes} lecciones</span>
            </div>

            {/* Mi progreso */}
            {data.myCompletedNodes > 0 && (
              <div className="mb-6">
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Tu progreso</span><span>{data.myCompletedNodes}/{data.totalNodes} · {progressPct}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            {/* Acciones */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <button
                onClick={handleStudy}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-2xl px-8 py-3.5 font-bold text-lg transition-all shadow-[0_0_25px_rgba(139,92,246,0.3)]"
              >
                <Play className="w-5 h-5" /> {data.myCompletedNodes > 0 ? "Continuar" : session ? "Estudiar" : "Estudiar gratis"}
              </button>
              <button
                onClick={handleFavorite}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 font-bold transition-all ${
                  isFavorite ? "bg-rose-500/15 text-rose-400 border border-rose-500/40" : "bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-700"
                }`}
              >
                <Heart className={`w-5 h-5 ${isFavorite ? "fill-current" : ""}`} /> {favoriteCount}
              </button>
              <button
                onClick={handleShare}
                title="Copiar link de la ruta"
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 font-bold transition-all border ${
                  linkCopied ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                }`}
              >
                {linkCopied ? <Check className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
                {linkCopied ? "¡Copiado!" : "Compartir"}
              </button>
              {videosEstado === "listo" && (
                <button
                  onClick={() => router.push(`/scroll?route=${id}`)}
                  className="inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 font-bold transition-all bg-fuchsia-600/15 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-600/25"
                >
                  <Film className="w-5 h-5" /> Modo Scroll
                </button>
              )}
            </div>

            {!session && (
              <p className="text-zinc-500 text-sm mb-6 -mt-2">
                Crea tu cuenta gratis en segundos y empieza a estudiar esta ruta de inmediato.
              </p>
            )}

            {/* Calificar (solo con cuenta) */}
            {session && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 mb-4">
                <p className="text-sm text-zinc-400 mb-2">{myRating ? "Tu calificación" : "Califica esta ruta"}</p>
                <StarRating value={myRating} onRate={handleRate} size="w-7 h-7" />
              </div>
            )}

            {/* Controles del dueño */}
            {data.isOwner && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-4">
                <div>
                  <p className="text-sm text-zinc-400 mb-3">Visibilidad</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleVisibility("public")}
                      className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${visibility === "public" ? "bg-primary/15 text-primary border border-primary/40" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}
                    >
                      <Globe className="w-4 h-4" /> Pública
                    </button>
                    <button
                      onClick={() => handleVisibility("private")}
                      className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${visibility === "private" ? "bg-zinc-700/40 text-white border border-zinc-500" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}
                    >
                      <Lock className="w-4 h-4" /> Privada
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-zinc-400 mb-2">Categoría</p>
                  <select
                    value={category}
                    onChange={e => handleCategory(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    {ROUTE_CATEGORIES.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div className="pt-3 border-t border-zinc-800">
                  <p className="text-sm text-zinc-400 mb-2 flex items-center gap-2">
                    <Film className="w-4 h-4 text-fuchsia-400" /> Modo Scroll
                  </p>
                  {videosEstado === "listo" ? (
                    <div>
                      <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 mb-2">
                        <Check className="w-4 h-4" /> Cortos listos
                      </p>
                      <button
                        onClick={handleRegenerarVideos}
                        disabled={genVideos}
                        className="inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-fuchsia-300 border border-zinc-700 rounded-xl px-4 py-2 text-sm font-bold transition-all disabled:opacity-60"
                      >
                        {genVideos ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Regenerar videos
                      </button>
                      <p className="text-zinc-600 text-[11px] mt-1">Gratis. Rehace todos los cortos con la última versión del Director.</p>

                      {/* Integrar cortos en el estudio de la lección (ruta completa) */}
                      <div className="mt-4 pt-4 border-t border-zinc-800">
                        {cortosIntegrados ? (
                          <>
                            <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 mb-2">
                              <Check className="w-4 h-4" /> Cortos integrados en las lecciones
                            </p>
                            <button
                              onClick={() => handleIntegrarCortos(false)}
                              disabled={integrating}
                              className="block text-xs font-bold text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-60"
                            >
                              {integrating ? "Quitando…" : "Quitar de las lecciones"}
                            </button>
                            <p className="text-zinc-600 text-[11px] mt-1">Al estudiar la ruta, el corto acompaña el audio de cada lección.</p>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleIntegrarCortos(true)}
                              disabled={integrating}
                              className="inline-flex items-center gap-2 bg-fuchsia-600/15 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-600/25 rounded-xl px-4 py-2 text-sm font-bold transition-all disabled:opacity-60"
                            >
                              {integrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
                              Integrar cortos a las lecciones
                            </button>
                            <p className="text-zinc-600 text-[11px] mt-1">Muestra el corto durante el audio al estudiar la ruta (además del Modo Scroll).</p>
                          </>
                        )}
                      </div>
                    </div>
                  ) : videosEstado === "generando" ? (
                    <div>
                      <div className="flex items-center gap-2 text-sm text-fuchsia-300 font-bold mb-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generando cortos
                        {jobProgress && jobProgress.total > 0 && (
                          <span className="text-zinc-500 font-normal">{jobProgress.completed}/{jobProgress.total}</span>
                        )}
                      </div>
                      {jobProgress && jobProgress.total > 0 && (
                        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-fuchsia-500 to-violet-500 transition-all"
                            style={{ width: `${Math.round((jobProgress.completed / jobProgress.total) * 100)}%` }}
                          />
                        </div>
                      )}
                      <button
                        onClick={handleGenerarVideos}
                        disabled={genVideos}
                        className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-fuchsia-300/80 hover:text-fuchsia-200 disabled:opacity-50"
                      >
                        {genVideos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
                        Reanudar generación
                      </button>
                      <p className="text-zinc-600 text-[11px] mt-1">¿Atascado? Vuelve a disparar el proceso.</p>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={handleGenerarVideos}
                        disabled={genVideos}
                        className="inline-flex items-center gap-2 bg-fuchsia-600/15 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-600/25 rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-60"
                      >
                        {genVideos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
                        {videosEstado === "error" ? "Reintentar videos" : "Generar video"}
                      </button>
                      <p className="text-zinc-600 text-xs mt-2">
                        Crea un corto vertical por lección para el feed estilo reels. Gratis, incluido para tu ruta.
                      </p>
                    </>
                  )}
                  {genError && <p className="text-rose-400 text-xs mt-2">{genError}</p>}
                </div>

                <div className="pt-3 border-t border-zinc-800">
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-2 text-sm font-bold text-rose-400 hover:text-rose-300 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Eliminar esta ruta
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── ESTUDIANTES: la comunidad de la ruta, con su reputación ── */}
        {students && students.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-emerald-400" />
              {data.isOwner ? "Tus estudiantes" : "Estudiantes de esta ruta"}
            </h2>
            <p className="text-zinc-500 text-sm mb-5">
              {data.isOwner
                ? "Las personas que están aprendiendo con tu conocimiento. Los que llegan al 80% cuentan como graduados para tu rango de creador."
                : "Personas que están recorriendo esta ruta. Visita sus perfiles."}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {students.map((st, i) => {
                const rank = explorerRank(st.routesCompleted, st.explorerAvgStars);
                const clickable = !st.anonymous && st.username;
                const inner = (
                  <>
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0">
                      {st.anonymous ? (
                        <EyeOff className="w-4 h-4 text-zinc-600" />
                      ) : st.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={st.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-zinc-500">{(st.displayName || st.username || "?")[0]?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold truncate ${st.anonymous ? "text-zinc-500 italic" : "text-white"}`}>
                          {st.anonymous ? "Explorador anónimo" : (st.displayName || `@${st.username}`)}
                        </span>
                        <RankPill track="explorer" rank={rank} size="xs" />
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${st.completionPct >= 80 ? "bg-emerald-500" : "bg-gradient-to-r from-primary to-secondary"}`}
                            style={{ width: `${st.completionPct}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-bold shrink-0 ${st.completionPct >= 80 ? "text-emerald-400" : "text-zinc-500"}`}>
                          {st.completionPct}%
                        </span>
                        {st.avgStars !== null && (
                          <span className="text-[11px] text-amber-400 shrink-0 flex items-center gap-0.5">
                            <Star className="w-3 h-3 fill-current" /> {st.avgStars}
                          </span>
                        )}
                      </div>
                    </div>
                    {st.completionPct >= 80 && <GraduationCap className="w-4 h-4 text-emerald-400 shrink-0" />}
                  </>
                );
                return clickable ? (
                  <button
                    key={i}
                    onClick={() => router.push(`/u/${st.username}`)}
                    className="flex items-center gap-3 bg-zinc-900/80 border border-zinc-800 hover:border-primary rounded-2xl p-3 text-left transition-all"
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={i} className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800/70 rounded-2xl p-3">
                    {inner}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {editingCover && token && (
        <CoverEditor
          token={token}
          routeId={id}
          topic={data.topic}
          currentCoverUrl={coverUrl}
          currentPrompt={data.coverPrompt}
          onUpdated={setCoverUrl}
          onClose={() => setEditingCover(false)}
        />
      )}

      {/* Confirmación de borrado */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(false)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-md relative"
          >
            <button onClick={() => !deleting && setConfirmDelete(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/40 rounded-2xl flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6 text-rose-400" />
            </div>
            <h3 className="text-xl font-bold mb-2">¿Eliminar &quot;{data.topic}&quot;?</h3>
            <p className="text-zinc-400 text-sm mb-1">
              Se borrarán para siempre sus lecciones, audios, portada, calificaciones y el progreso de todos sus estudiantes.
            </p>
            <p className="text-zinc-500 text-xs mb-5">Esta acción no se puede deshacer. Liberarás 1 espacio de tu cuota.</p>
            {deleteError && <p className="text-rose-400 text-sm mb-3">{deleteError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 transition-all disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-3 rounded-2xl bg-rose-500 text-white font-bold hover:bg-rose-400 transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Eliminar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </main>
  );
}
