"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Play, Users, Star, Heart, BarChart3, BookOpen, Globe, Lock, ImageIcon, AlertTriangle } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getRouteLanding, rateRoute, toggleFavorite, setRouteVisibility } from "@/app/socialActions";
import type { RouteLanding } from "@/lib/types";
import AppHeader from "@/components/AppHeader";
import StarRating from "@/components/StarRating";
import CoverEditor from "@/components/CoverEditor";

export default function RouteLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { token, loading, session } = useRequireAuth();
  const [data, setData] = useState<RouteLanding | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editingCover, setEditingCover] = useState(false);

  // estado local optimista
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [ratingAvg, setRatingAvg] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [visibility, setVisibility] = useState<"public" | "private">("public");

  useEffect(() => {
    if (!token) return;
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
    });
  }, [token, id]);

  const handleRate = async (stars: number) => {
    if (!token) return;
    setMyRating(stars);
    const res = await rateRoute(token, id, stars);
    if (res.ok) { setRatingAvg(res.ratingAvg); setRatingCount(res.ratingCount); }
  };

  const handleFavorite = async () => {
    if (!token) return;
    setIsFavorite(f => !f);
    const res = await toggleFavorite(token, id);
    if (res.ok) { setIsFavorite(res.isFavorite); setFavoriteCount(res.favoriteCount); }
  };

  const handleVisibility = async (v: "public" | "private") => {
    if (!token) return;
    setVisibility(v);
    await setRouteVisibility(token, id, v);
  };

  if (loading || !session) {
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
            <h1 className="text-3xl md:text-4xl font-bold mb-3">{data.topic}</h1>

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
            </button>

            {data.description && <p className="text-zinc-300 mb-5 leading-relaxed">{data.description}</p>}

            {/* Métricas */}
            <div className="flex flex-wrap gap-4 mb-6 text-sm">
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
                onClick={() => router.push(`/tree?route=${id}`)}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-2xl px-8 py-3.5 font-bold text-lg transition-all"
              >
                <Play className="w-5 h-5" /> {data.myCompletedNodes > 0 ? "Continuar" : "Estudiar"}
              </button>
              <button
                onClick={handleFavorite}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 font-bold transition-all ${
                  isFavorite ? "bg-rose-500/15 text-rose-400 border border-rose-500/40" : "bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-700"
                }`}
              >
                <Heart className={`w-5 h-5 ${isFavorite ? "fill-current" : ""}`} /> {favoriteCount}
              </button>
            </div>

            {/* Calificar */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 mb-4">
              <p className="text-sm text-zinc-400 mb-2">{myRating ? "Tu calificación" : "Califica esta ruta"}</p>
              <StarRating value={myRating} onRate={handleRate} size="w-7 h-7" />
            </div>

            {/* Controles del dueño */}
            {data.isOwner && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
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
            )}
          </div>
        </div>
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
    </main>
  );
}
