"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Users, Star, BookOpen, Settings, AlertTriangle, Crown, Plus, Lock, EyeOff, Hammer, X, GraduationCap } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getProfileByUsername, getPlan } from "@/app/socialActions";
import type { PublicProfile, PlanState } from "@/lib/types";
import { explorerRank, creatorRank, explorerProgress, creatorProgress } from "@/lib/reputation";
import AppHeader from "@/components/AppHeader";
import RouteCard from "@/components/RouteCard";
import FollowButton from "@/components/FollowButton";
import { RankPill, RankCard } from "@/components/ReputationBadge";

export default function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const router = useRouter();
  const { token, loading, session } = useRequireAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [creatorRankUp, setCreatorRankUp] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    getProfileByUsername(token, username).then(p => {
      if (p) setProfile(p);
      else setNotFound(true);
    });
  }, [token, username]);

  // Celebración de rank-up de CREADOR: al visitar tu propio perfil, comparamos
  // tu rango con el último que viste (localStorage) y celebramos si subió.
  useEffect(() => {
    if (!profile?.isOwner) return;
    const level = creatorRank(profile.stats.graduates).level;
    const seen = parseInt(localStorage.getItem("lf_creator_rank") || "1", 10);
    if (level > seen && level > 1) setCreatorRankUp(level);
    localStorage.setItem("lf_creator_rank", String(level));
  }, [profile]);

  // Cuota de creación: privada, solo cuando es tu propio perfil
  useEffect(() => {
    if (!token || !profile?.isOwner) return;
    getPlan(token).then(setPlan);
  }, [token, profile?.isOwner]);

  if (loading || !session) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>;
  }

  if (notFound) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <AppHeader />
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Perfil no encontrado</h1>
          <button onClick={() => router.push("/")} className="mt-4 px-6 py-3 rounded-2xl bg-primary text-white font-bold">Volver al inicio</button>
        </div>
      </main>
    );
  }

  if (!profile) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>;
  }

  const s = profile.stats;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AppHeader />

      <div className="max-w-5xl mx-auto px-4 pb-16">
        {/* Banner */}
        <div className="h-44 md:h-56 rounded-b-3xl overflow-hidden bg-gradient-to-br from-primary/30 to-secondary/30 border-x border-b border-zinc-900 relative">
          {profile.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.bannerUrl} alt="banner" className="w-full h-full object-cover" />
          )}
        </div>

        {/* Cabecera del perfil (relative z-10: debe pintarse SOBRE el banner posicionado) */}
        <div className="relative z-10 px-2 md:px-6 -mt-12 mb-8 flex flex-col md:flex-row md:items-end gap-4">
          <div className="w-28 h-28 rounded-full overflow-hidden bg-zinc-800 border-4 border-zinc-950 shrink-0">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt={profile.username || ""} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-zinc-500">
                {(profile.displayName || profile.username || "?")[0]?.toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 flex-wrap">
              {profile.displayName || `@${profile.username}`}
            </h1>
            {profile.username && <p className="text-zinc-500">@{profile.username}</p>}
            {/* Rangos: el estatus se lleva junto al nombre */}
            <div className="flex flex-wrap gap-2 mt-2">
              <RankPill track="explorer" rank={explorerRank(s.routesCompleted, s.avgStars)} />
              <RankPill track="creator" rank={creatorRank(s.graduates)} />
            </div>
            {profile.bio && <p className="text-zinc-300 mt-2 max-w-xl">{profile.bio}</p>}
          </div>

          <div className="shrink-0">
            {profile.isOwner ? (
              <button onClick={() => router.push("/settings/profile")} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-all">
                <Settings className="w-4 h-4" /> Editar perfil
              </button>
            ) : token ? (
              <FollowButton token={token} targetUserId={profile.id} initialFollowing={profile.isFollowing} />
            ) : null}
          </div>
        </div>

        {/* ── REPUTACIÓN: las dos vías, con camino de medallas y meta visible ── */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <RankCard
            track="explorer"
            progress={explorerProgress(s.routesCompleted, s.avgStars)}
            statLabel={`${s.routesCompleted} ${s.routesCompleted === 1 ? "ruta completada" : "rutas completadas"}${s.avgStars > 0 ? ` · ${s.avgStars.toFixed(1)}★ de media` : ""}`}
          />
          <RankCard
            track="creator"
            progress={creatorProgress(s.graduates)}
            statLabel={`${s.graduates} ${s.graduates === 1 ? "estudiante graduado" : "estudiantes graduados"} (≥80% completado)`}
          />
        </div>

        {/* Perfil privado (viewer ajeno): solo identidad y rangos */}
        {!profile.profilePublic && !profile.isOwner && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center mb-8">
            <EyeOff className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400 font-bold mb-1">Este perfil es privado</p>
            <p className="text-zinc-600 text-sm">Su dueño solo comparte sus rangos de reputación.</p>
          </div>
        )}

        {/* Cuota de creación — privada (solo el dueño la ve) */}
        {profile.isOwner && plan && (() => {
          const atLimit = plan.routesUsed >= plan.routeQuota;
          const isPremium = plan.plan === "premium";
          const pct = plan.routeQuota > 0 ? Math.min(100, Math.round((plan.routesUsed / plan.routeQuota) * 100)) : 0;
          return (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5"
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="text-xs text-zinc-500">Solo tú ves esto</span>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${
                  isPremium ? "bg-amber-500/15 text-amber-300 border border-amber-500/40" : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                }`}>
                  {isPremium && <Crown className="w-3.5 h-3.5" />} Plan {isPremium ? "Premium" : "Gratis"}
                </span>
              </div>

              <div className="flex items-end justify-between gap-3 mb-2">
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500 font-bold">Rutas creadas</p>
                  <p className="text-2xl font-bold text-white">
                    {plan.routesUsed}<span className="text-zinc-500 text-lg"> / {plan.routeQuota}</span>
                  </p>
                </div>
                {atLimit ? (
                  !isPremium ? (
                    <button onClick={() => router.push("/sources")} className="inline-flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-full bg-amber-500 text-amber-950 hover:bg-amber-400 transition-all">
                      <Crown className="w-4 h-4" /> Hazte Premium
                    </button>
                  ) : (
                    <span className="text-sm text-zinc-500">Cuota completa</span>
                  )
                ) : (
                  <button onClick={() => router.push("/sources")} className="inline-flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-full bg-primary text-white hover:bg-primary-hover transition-all">
                    <Plus className="w-4 h-4" /> Crear ruta
                  </button>
                )}
              </div>

              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${atLimit ? "bg-amber-500" : "bg-gradient-to-r from-primary to-secondary"}`} style={{ width: `${pct}%` }} />
              </div>
              {!isPremium && (
                <p className="text-xs text-zinc-500 mt-2">
                  {atLimit ? "Ya usaste tu ruta gratuita. Premium te da hasta 3 rutas." : "Plan gratuito: 1 ruta. Estudiar la biblioteca siempre es gratis."}
                </p>
              )}
            </motion.div>
          );
        })()}

        {(profile.profilePublic || profile.isOwner) && (<>
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
          <Stat icon={<BookOpen className="w-4 h-4 text-primary" />} label="Rutas" value={s.routeCount} />
          <Stat icon={<Users className="w-4 h-4 text-secondary" />} label="Estudiantes" value={s.studentTotal} />
          <Stat icon={<GraduationCap className="w-4 h-4 text-emerald-400" />} label="Graduados" value={s.graduates} />
          <Stat icon={<Star className="w-4 h-4 text-amber-400" />} label="Valoración" value={s.ratingAvg ?? "—"} />
          <Stat icon={<Users className="w-4 h-4 text-zinc-400" />} label="Seguidores" value={s.followers} />
        </div>

        {/* Rutas */}
        <h2 className="text-xl font-bold mb-4">Rutas de {profile.displayName || `@${profile.username}`}</h2>
        {profile.routes.length === 0 ? (
          <p className="text-zinc-500 py-8 text-center">Todavía no hay rutas públicas.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {profile.routes.map(r => <RouteCard key={r.id} route={r} compact />)}
          </div>
        )}
        </>)}
      </div>

      {/* 🎉 Celebración de rank-up de CREADOR */}
      <AnimatePresence>
        {creatorRankUp && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setCreatorRankUp(null)}>
            <motion.div
              initial={{ scale: 0.7, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 18 }}
              onClick={e => e.stopPropagation()}
              className="bg-zinc-900 border border-violet-500/40 rounded-3xl p-8 w-full max-w-sm text-center relative shadow-[0_0_60px_rgba(139,92,246,0.35)]"
            >
              <button onClick={() => setCreatorRankUp(null)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
              <motion.div
                initial={{ rotate: -15, scale: 0 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ delay: 0.15, type: "spring", stiffness: 220 }}
                className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-violet-500/15 border-2 border-violet-400/70 flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.5)]"
              >
                <Hammer className="w-10 h-10 text-violet-300" />
              </motion.div>
              <p className="text-xs uppercase tracking-widest font-bold text-violet-400 mb-1">¡Subiste de rango como creador!</p>
              <h3 className="text-3xl font-bold mb-2">{creatorRank(s.graduates).name}</h3>
              <p className="text-zinc-400 text-sm mb-6">
                {s.graduates} estudiantes ya se graduaron de tus rutas. Tu conocimiento está dejando huella.
              </p>
              <button
                onClick={() => setCreatorRankUp(null)}
                className="w-full py-3 rounded-2xl bg-violet-500 hover:bg-violet-400 text-white font-bold transition-all"
              >
                Seguir creando
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-zinc-500 text-xs mb-1">{icon} {label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </motion.div>
  );
}
