"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Shield, Search, Minus, Plus, Check, Crown, User as UserIcon, AlertTriangle, Layers } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { checkIsAdmin, adminListUsers, adminSetUserQuota, adminSetBatchEnabled, type AdminUserRow } from "@/app/adminActions";
import AppHeader from "@/components/AppHeader";

export default function AdminPage() {
  const router = useRouter();
  const { token, loading, session } = useRequireAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  // edición local de cuota por usuario
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [batchSavingId, setBatchSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    checkIsAdmin(token).then(setIsAdmin);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoadingUsers(true);
    const list = await adminListUsers(token, search);
    setUsers(list);
    setDrafts(Object.fromEntries(list.map(u => [u.id, u.routeQuota])));
    setLoadingUsers(false);
  }, [token, search]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const save = async (userId: string) => {
    if (!token) return;
    setSavingId(userId);
    const res = await adminSetUserQuota(token, userId, drafts[userId] ?? 1);
    setSavingId(null);
    if (res.ok && res.routeQuota !== undefined) {
      setUsers(us => us.map(u => (u.id === userId ? { ...u, routeQuota: res.routeQuota! } : u)));
      setSavedId(userId);
      setTimeout(() => setSavedId(s => (s === userId ? null : s)), 1500);
    }
  };

  const setDraft = (id: string, v: number) => setDrafts(d => ({ ...d, [id]: Math.max(0, Math.min(999, v)) }));

  const toggleBatch = async (userId: string, enabled: boolean) => {
    if (!token) return;
    setBatchSavingId(userId);
    const res = await adminSetBatchEnabled(token, userId, enabled);
    setBatchSavingId(null);
    if (res.ok && res.batchEnabled !== undefined) {
      setUsers(us => us.map(u => (u.id === userId ? { ...u, batchEnabled: res.batchEnabled! } : u)));
    }
  };

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

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AppHeader />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Panel de administración</h1>
        </div>
        <p className="text-zinc-500 mb-8">Regala cuota de creación de rutas a cualquier usuario.</p>

        {/* Buscador */}
        <form
          onSubmit={e => { e.preventDefault(); load(); }}
          className="relative mb-6"
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por correo o usuario..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-11 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
          />
        </form>

        {loadingUsers ? (
          <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando usuarios...</div>
        ) : users.length === 0 ? (
          <p className="text-zinc-500 py-10 text-center">No se encontraron usuarios.</p>
        ) : (
          <div className="space-y-3">
            {users.map(u => {
              const draft = drafts[u.id] ?? u.routeQuota;
              const dirty = draft !== u.routeQuota;
              return (
                <motion.div
                  key={u.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4"
                >
                  <div className="w-11 h-11 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0">
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-5 h-5 text-zinc-500" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white truncate">{u.displayName || (u.username ? `@${u.username}` : u.email)}</span>
                      {u.plan === "premium" && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                      {u.role === "admin" && <span className="text-[10px] uppercase font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">admin</span>}
                    </div>
                    <p className="text-xs text-zinc-500 truncate">{u.email}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">{u.routesUsed} rutas creadas · cuota actual {u.routeQuota}</p>
                  </div>

                  {/* Toggle de creación en lote (exclusiva, manual por usuario) */}
                  <button
                    onClick={() => toggleBatch(u.id, !u.batchEnabled)}
                    disabled={batchSavingId === u.id}
                    title={u.batchEnabled ? "Desactivar creación en lote" : "Activar creación en lote"}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                      u.batchEnabled
                        ? "bg-violet-500/15 text-violet-300 border-violet-500/50"
                        : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300"
                    }`}
                  >
                    {batchSavingId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                    Lote {u.batchEnabled ? "ON" : "OFF"}
                  </button>

                  {/* Editor de cuota */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setDraft(u.id, draft - 1)} className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300"><Minus className="w-4 h-4" /></button>
                    <input
                      type="number"
                      value={draft}
                      onChange={e => setDraft(u.id, parseInt(e.target.value, 10) || 0)}
                      className="w-14 text-center bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 text-white focus:outline-none focus:border-primary"
                    />
                    <button onClick={() => setDraft(u.id, draft + 1)} className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300"><Plus className="w-4 h-4" /></button>
                    <button
                      onClick={() => save(u.id)}
                      disabled={!dirty || savingId === u.id}
                      className={`ml-1 h-8 px-3 rounded-lg font-bold text-sm flex items-center gap-1 transition-all ${
                        savedId === u.id ? "bg-emerald-500 text-emerald-950" : dirty ? "bg-primary text-white hover:bg-primary-hover" : "bg-zinc-800 text-zinc-600 cursor-default"
                      }`}
                    >
                      {savingId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : savedId === u.id ? <Check className="w-4 h-4" /> : "Guardar"}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
