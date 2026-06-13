"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Shield, Search, Minus, Plus, Check, Crown, User as UserIcon, AlertTriangle, Layers, Users, BookOpen, Globe, Lock, EyeOff, Eye, Trash2, X, CreditCard, Copy, Webhook, RefreshCw } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import {
  checkIsAdmin, adminListUsers, adminSetUserQuota, adminSetBatchEnabled, type AdminUserRow,
  adminListRoutes, adminSetRouteVisibility, adminSetRouteBlocked, adminDeleteRoute, type AdminRouteRow,
  adminGetBoldOverview, adminActivatePremium, type BoldOverview, type BoldOrderRow,
} from "@/app/adminActions";
import AppHeader from "@/components/AppHeader";

export default function AdminPage() {
  const router = useRouter();
  const { token, loading, session } = useRequireAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"users" | "routes" | "pagos">("users");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  // edición local de cuota por usuario
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [batchSavingId, setBatchSavingId] = useState<string | null>(null);

  // Moderación de cursos
  const [routes, setRoutes] = useState<AdminRouteRow[]>([]);
  const [routeSearch, setRouteSearch] = useState("");
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routeBusyId, setRouteBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminRouteRow | null>(null);

  // Pagos (Bold)
  const [bold, setBold] = useState<BoldOverview | null>(null);
  const [loadingBold, setLoadingBold] = useState(false);
  const [boldBusyId, setBoldBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setWebhookUrl(`${window.location.origin}/api/bold/webhook`);
  }, []);

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

  // ── Cursos ──
  const loadRoutes = useCallback(async () => {
    if (!token) return;
    setLoadingRoutes(true);
    const list = await adminListRoutes(token, routeSearch);
    setRoutes(list);
    setLoadingRoutes(false);
  }, [token, routeSearch]);

  useEffect(() => {
    if (isAdmin && tab === "routes") loadRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, tab]);

  const toggleVisibility = async (r: AdminRouteRow) => {
    if (!token) return;
    const next = r.visibility === "public" ? "private" : "public";
    setRouteBusyId(r.id);
    const res = await adminSetRouteVisibility(token, r.id, next);
    setRouteBusyId(null);
    if (res.ok) setRoutes(rs => rs.map(x => (x.id === r.id ? { ...x, visibility: next } : x)));
  };

  const toggleBlocked = async (r: AdminRouteRow) => {
    if (!token) return;
    setRouteBusyId(r.id);
    const res = await adminSetRouteBlocked(token, r.id, !r.blocked);
    setRouteBusyId(null);
    if (res.ok) setRoutes(rs => rs.map(x => (x.id === r.id ? { ...x, blocked: !r.blocked } : x)));
  };

  const doDeleteRoute = async () => {
    if (!token || !confirmDelete) return;
    const id = confirmDelete.id;
    setRouteBusyId(id);
    const res = await adminDeleteRoute(token, id);
    setRouteBusyId(null);
    if (res.ok) {
      setRoutes(rs => rs.filter(x => x.id !== id));
      setConfirmDelete(null);
    }
  };

  // ── Pagos (Bold) ──
  const loadBold = useCallback(async () => {
    if (!token) return;
    setLoadingBold(true);
    const ov = await adminGetBoldOverview(token);
    setBold(ov);
    setLoadingBold(false);
  }, [token]);

  useEffect(() => {
    if (isAdmin && tab === "pagos") loadBold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, tab]);

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard bloqueado: el usuario puede copiar a mano */
    }
  };

  const activatePremium = async (o: BoldOrderRow) => {
    if (!token) return;
    setBoldBusyId(o.orderId);
    const res = await adminActivatePremium(token, o.userId, o.orderId);
    setBoldBusyId(null);
    if (res.ok) {
      setBold(ov =>
        ov
          ? { ...ov, orders: ov.orders.map(x => (x.orderId === o.orderId ? { ...x, status: "paid", userPlan: "premium" } : x)) }
          : ov
      );
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
        <p className="text-zinc-500 mb-6">Gestiona la cuota de creación de los usuarios y modera la biblioteca de cursos.</p>

        {/* Pestañas */}
        <div className="inline-flex bg-zinc-900 border border-zinc-800 rounded-2xl p-1 mb-7">
          <button
            onClick={() => setTab("users")}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all ${tab === "users" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"}`}
          >
            <Users className="w-4 h-4" /> Usuarios
          </button>
          <button
            onClick={() => setTab("routes")}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all ${tab === "routes" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"}`}
          >
            <BookOpen className="w-4 h-4" /> Cursos
          </button>
          <button
            onClick={() => setTab("pagos")}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all ${tab === "pagos" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"}`}
          >
            <CreditCard className="w-4 h-4" /> Pagos
          </button>
        </div>

        {tab === "users" && (<>
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
        </>)}

        {tab === "routes" && (<>
        {/* Buscador de cursos */}
        <form onSubmit={e => { e.preventDefault(); loadRoutes(); }} className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            value={routeSearch}
            onChange={e => setRouteSearch(e.target.value)}
            placeholder="Buscar curso por tema..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-11 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
          />
        </form>

        {loadingRoutes ? (
          <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando cursos...</div>
        ) : routes.length === 0 ? (
          <p className="text-zinc-500 py-10 text-center">No se encontraron cursos.</p>
        ) : (
          <div className="space-y-3">
            {routes.map(r => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-zinc-900/80 border rounded-2xl p-4 flex items-center gap-4 ${r.blocked ? "border-rose-500/40" : "border-zinc-800"}`}
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
                    {!r.blocked && r.visibility === "private" && <span className="text-[10px] uppercase font-bold text-zinc-300 bg-zinc-700/50 px-1.5 py-0.5 rounded shrink-0">privado</span>}
                  </div>
                  <p className="text-xs text-zinc-500 truncate">por {r.ownerName} · {r.categoryLabel} · {r.studentCount} est.</p>
                </div>

                {/* Público / Privado */}
                <button
                  onClick={() => toggleVisibility(r)}
                  disabled={routeBusyId === r.id || r.blocked}
                  title={r.visibility === "public" ? "Pasar a privado" : "Hacer pública"}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all disabled:opacity-40 ${
                    r.visibility === "public" ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white"
                  }`}
                >
                  {r.visibility === "public" ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  {r.visibility === "public" ? "Pública" : "Privada"}
                </button>

                {/* Sacar del aire / Reactivar */}
                <button
                  onClick={() => toggleBlocked(r)}
                  disabled={routeBusyId === r.id}
                  title={r.blocked ? "Reactivar (volver al aire)" : "Sacar del aire"}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all disabled:opacity-40 ${
                    r.blocked ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40 hover:bg-amber-500/20"
                  }`}
                >
                  {routeBusyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : r.blocked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {r.blocked ? "Reactivar" : "Sacar del aire"}
                </button>

                {/* Borrar */}
                <button
                  onClick={() => setConfirmDelete(r)}
                  disabled={routeBusyId === r.id}
                  title="Borrar para siempre"
                  className="shrink-0 w-8 h-8 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 flex items-center justify-center transition-all disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
        </>)}

        {tab === "pagos" && (<>
        {/* URL del webhook — lo que el admin pega en el dashboard de Bold. */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-1.5">
            <Webhook className="w-4 h-4 text-primary" />
            <h2 className="font-bold">URL del webhook de Bold</h2>
          </div>
          <p className="text-sm text-zinc-500 mb-3">
            Pégala en <span className="text-zinc-300">Bold → Integraciones → Webhooks</span>. Bold llamará a esta URL al aprobarse cada pago y el usuario quedará Premium automáticamente.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-300">{webhookUrl || "…"}</code>
            <button
              onClick={copyWebhook}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-all"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copiado" : "Copiar"}
            </button>
          </div>

          {bold && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${bold.configured ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}>
                {bold.configured ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {bold.configured ? "Llaves de Bold configuradas" : "Faltan BOLD_API_KEY / BOLD_SECRET_KEY"}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-zinc-800 text-zinc-400 border-zinc-700">
                Firma: {bold.signatureEnforced ? "obligatoria" : "registrada (no obligatoria)"}
              </span>
              {(!bold.ordersTableReady || !bold.transactionsTableReady) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-500/10 text-amber-300 border-amber-500/40">
                  <AlertTriangle className="w-3 h-3" /> Faltan tablas — corre scripts/bold-setup.sql en Supabase
                </span>
              )}
            </div>
          )}
        </div>

        {loadingBold ? (
          <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Cargando pagos...</div>
        ) : !bold ? (
          <p className="text-zinc-500 py-10 text-center">No se pudo cargar la información de pagos.</p>
        ) : (<>
          {/* Órdenes recientes (con remediación manual). */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">Órdenes recientes</h2>
            <button onClick={loadBold} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </button>
          </div>

          {!bold.ordersTableReady ? (
            <p className="text-amber-300/90 text-sm bg-amber-500/5 border border-amber-500/30 rounded-2xl p-4 mb-8">
              La tabla <code>payment_orders</code> no existe todavía. Corre <code>scripts/bold-setup.sql</code> en Supabase para empezar a recibir y activar pagos.
            </p>
          ) : bold.orders.length === 0 ? (
            <p className="text-zinc-500 py-6 text-center mb-8">Aún no hay órdenes de pago.</p>
          ) : (
            <div className="space-y-2 mb-8">
              {bold.orders.map(o => {
                const paid = o.status === "paid";
                const isPremium = o.userPlan === "premium";
                const needsActivation = paid && !isPremium; // pagó pero no se activó
                return (
                  <div key={o.orderId} className={`bg-zinc-900/80 border rounded-2xl p-4 flex items-center gap-3 ${needsActivation ? "border-amber-500/50" : "border-zinc-800"}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white truncate">{o.email}</span>
                        {isPremium && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${paid ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-700/50 text-zinc-300"}`}>
                          {paid ? "pagada" : "pendiente"}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {o.amount.toLocaleString("es-CO")} {o.currency} · {o.purpose} · {new Date(o.createdAt).toLocaleString("es-CO")} · <span className="text-zinc-600">{o.orderId}</span>
                      </p>
                    </div>
                    {!isPremium && (
                      <button
                        onClick={() => activatePremium(o)}
                        disabled={boldBusyId === o.orderId}
                        title="Subir este usuario a Premium ahora"
                        className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all disabled:opacity-40 ${
                          needsActivation
                            ? "bg-amber-500/15 text-amber-300 border-amber-500/50 hover:bg-amber-500/25"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white"
                        }`}
                      >
                        {boldBusyId === o.orderId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" />}
                        Activar Premium
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Confirmaciones crudas recibidas en el webhook (prueba de recepción). */}
          <h2 className="font-bold text-lg mb-3">Confirmaciones recibidas</h2>
          {!bold.transactionsTableReady ? (
            <p className="text-amber-300/90 text-sm bg-amber-500/5 border border-amber-500/30 rounded-2xl p-4">
              La tabla <code>bold_transactions</code> no existe todavía. Corre <code>scripts/bold-setup.sql</code> en Supabase.
            </p>
          ) : bold.transactions.length === 0 ? (
            <p className="text-zinc-500 py-6 text-center">
              Todavía no llega ninguna confirmación de Bold. Si ya configuraste el webhook y pagaste, espera unos segundos y pulsa Actualizar.
            </p>
          ) : (
            <div className="space-y-2">
              {bold.transactions.map(t => {
                const ok = t.type.toUpperCase().includes("APPROV") || t.type.toUpperCase().includes("SUCCESS");
                return (
                  <div key={t.paymentId} className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-700/50 text-zinc-300"}`}>{t.type}</span>
                        <span className="text-sm text-zinc-300">{t.amount.toLocaleString("es-CO")} {t.currency}</span>
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {new Date(t.createdAt).toLocaleString("es-CO")} · ref {t.orderReference || "—"} · <span className="text-zinc-600">{t.paymentId}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>)}
        </>)}
      </div>

      {/* Confirmar borrado de curso */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => routeBusyId === null && setConfirmDelete(null)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-md relative"
          >
            <button onClick={() => routeBusyId === null && setConfirmDelete(null)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/40 rounded-2xl flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6 text-rose-400" />
            </div>
            <h3 className="text-xl font-bold mb-2">¿Borrar &quot;{confirmDelete.topic}&quot;?</h3>
            <p className="text-zinc-400 text-sm mb-1">
              Se eliminarán para siempre sus lecciones, audios, portada y el progreso de todos sus estudiantes.
            </p>
            <p className="text-zinc-500 text-xs mb-5">Curso de {confirmDelete.ownerName}. Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={routeBusyId !== null} className="flex-1 py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 transition-all disabled:opacity-60">Cancelar</button>
              <button onClick={doDeleteRoute} disabled={routeBusyId !== null} className="flex-1 py-3 rounded-2xl bg-rose-500 text-white font-bold hover:bg-rose-400 transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {routeBusyId !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Borrar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </main>
  );
}
