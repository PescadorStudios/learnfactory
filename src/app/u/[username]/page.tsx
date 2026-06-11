"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Users, Star, BookOpen, Settings, AlertTriangle } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getProfileByUsername } from "@/app/socialActions";
import type { PublicProfile } from "@/lib/types";
import AppHeader from "@/components/AppHeader";
import RouteCard from "@/components/RouteCard";
import FollowButton from "@/components/FollowButton";

export default function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const router = useRouter();
  const { token, loading, session } = useRequireAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) return;
    getProfileByUsername(token, username).then(p => {
      if (p) setProfile(p);
      else setNotFound(true);
    });
  }, [token, username]);

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
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              {profile.displayName || `@${profile.username}`}
            </h1>
            {profile.username && <p className="text-zinc-500">@{profile.username}</p>}
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

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <Stat icon={<BookOpen className="w-4 h-4 text-primary" />} label="Rutas" value={s.routeCount} />
          <Stat icon={<Users className="w-4 h-4 text-secondary" />} label="Estudiantes" value={s.studentTotal} />
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
      </div>
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
