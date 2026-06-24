"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, Shield, AlertTriangle, User as UserIcon, Crown, BookOpen, Star, GraduationCap, Clock, PlayCircle } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { checkIsAdmin, adminGetUserStudy, type AdminUserStudy } from "@/app/adminActions";
import AppHeader from "@/components/AppHeader";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

export default function AdminUserStudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { token, loading, session } = useRequireAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [data, setData] = useState<AdminUserStudy | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!token) return;
    checkIsAdmin(token).then(setIsAdmin);
  }, [token]);

  useEffect(() => {
    if (!token || !isAdmin) return;
    setLoadingData(true);
    adminGetUserStudy(token, id).then(d => {
      setData(d);
      setLoadingData(false);
    });
  }, [token, isAdmin, id]);

  if (loading || !session || isAdmin === null) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>;
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <AppHeader />
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Acceso restringido</h1>
          <p className="text-zinc-500 mb-4">Esta sección es solo para administradores.</p>
          <button onClick={() => router.push("/")} className="px-6 py-3 rounded-2xl bg-primary text-white font-bold">Volver al inicio</button>
        </div>
      </main>
    );
  }

  const u = data?.user;
  const started = data?.routes.filter(r => r.completedNodes === 0) ?? [];
  const inProgress = data?.routes.filter(r => r.completedNodes > 0 && r.completionPct < 80) ?? [];
  const graduated = data?.routes.filter(r => r.completionPct >= 80) ?? [];

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AppHeader />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <button onClick={() => router.push("/admin")} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Volver al panel
        </button>

        <div className="flex items-center gap-2 mb-6 text-xs uppercase tracking-wider text-primary font-bold">
          <Shield className="w-3.5 h-3.5" /> Perfil de estudio
        </div>

        {loadingData ? (
          <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando perfil...</div>
        ) : !u ? (
          <p className="text-zinc-500 py-10 text-center">No se encontró el usuario.</p>
        ) : (<>
          {/* Cabecera del usuario */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0">
              {u.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-7 h-7 text-zinc-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold truncate">{u.displayName || (u.username ? `@${u.username}` : u.email)}</h1>
                {u.plan === "premium" && <Crown className="w-4 h-4 text-amber-400 shrink-0" />}
                {u.role === "admin" && <span className="text-[10px] uppercase font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">admin</span>}
              </div>
              <p className="text-sm text-zinc-500 truncate">{u.email}</p>
              <p className="text-xs text-zinc-600 mt-1">
                {u.routesCompleted} rutas completadas · {u.avgStars || 0}★ promedio · se unió el {fmtDate(u.createdAt)}
              </p>
            </div>
          </div>

          {/* Resumen */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{data!.routes.length}</p>
              <p className="text-xs text-zinc-500 mt-0.5">rutas comenzadas</p>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{inProgress.length}</p>
              <p className="text-xs text-zinc-500 mt-0.5">en progreso</p>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{graduated.length}</p>
              <p className="text-xs text-zinc-500 mt-0.5">graduadas (≥80%)</p>
            </div>
          </div>

          {data!.routes.length === 0 ? (
            <p className="text-zinc-500 py-10 text-center">Este usuario aún no ha comenzado ninguna ruta.</p>
          ) : (
            <div className="space-y-8">
              {graduated.length > 0 && <RouteGroup title="Graduadas" icon={<GraduationCap className="w-4 h-4 text-emerald-400" />} routes={graduated} onOpen={r => router.push(`/route/${r}`)} />}
              {inProgress.length > 0 && <RouteGroup title="En progreso" icon={<BookOpen className="w-4 h-4 text-primary" />} routes={inProgress} onOpen={r => router.push(`/route/${r}`)} />}
              {started.length > 0 && <RouteGroup title="Comenzadas (sin lecciones aún)" icon={<PlayCircle className="w-4 h-4 text-zinc-400" />} routes={started} onOpen={r => router.push(`/route/${r}`)} />}
            </div>
          )}
        </>)}
      </div>
    </main>
  );
}

function RouteGroup({ title, icon, routes, onOpen }: { title: string; icon: React.ReactNode; routes: AdminUserStudy["routes"]; onOpen: (routeId: string) => void }) {
  return (
    <section>
      <h2 className="text-sm font-bold text-zinc-300 mb-3 flex items-center gap-2">{icon} {title} <span className="text-zinc-600 font-normal">· {routes.length}</span></h2>
      <div className="space-y-3">
        {routes.map(r => (
          <motion.button
            key={r.routeId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => onOpen(r.routeId)}
            className="w-full bg-zinc-900/80 border border-zinc-800 hover:border-primary rounded-2xl p-4 flex items-center gap-4 text-left transition-all"
          >
            <div className="w-16 h-12 rounded-lg overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0">
              {r.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <BookOpen className="w-5 h-5 text-zinc-600" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white truncate">{r.topic}</span>
                {r.blocked && <span className="text-[10px] uppercase font-bold text-rose-300 bg-rose-500/15 px-1.5 py-0.5 rounded shrink-0">fuera del aire</span>}
                {!r.blocked && r.visibility === "private" && <span className="text-[10px] uppercase font-bold text-zinc-300 bg-zinc-700/50 px-1.5 py-0.5 rounded shrink-0">privada</span>}
              </div>
              <p className="text-xs text-zinc-500 truncate">por {r.ownerName}</p>

              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden max-w-[200px]">
                  <div
                    className={`h-full ${r.completionPct >= 80 ? "bg-emerald-500" : "bg-gradient-to-r from-primary to-secondary"}`}
                    style={{ width: `${r.completionPct}%` }}
                  />
                </div>
                <span className={`text-[11px] font-bold shrink-0 ${r.completionPct >= 80 ? "text-emerald-400" : "text-zinc-500"}`}>
                  {r.completedNodes}/{r.totalNodes} · {r.completionPct}%
                </span>
                {r.avgStars !== null && (
                  <span className="text-[11px] text-amber-400 shrink-0 flex items-center gap-0.5">
                    <Star className="w-3 h-3 fill-current" /> {r.avgStars}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-zinc-600 mt-1.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Comenzó {fmtDate(r.startedAt)}
                {r.lastActivityAt && <span> · última actividad {fmtDate(r.lastActivityAt)}</span>}
              </p>
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
