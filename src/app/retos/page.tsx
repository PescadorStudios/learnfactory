"use client";

// "Mis Retos" — panel del creador: lista de retos con su estado y acceso al
// dashboard, más la WALLET (saldo 80/20, histórico y datos bancarios de
// payout). El payout es manual: el admin marca los movimientos liquidados.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Plus,
  Loader2,
  Wallet,
  Landmark,
  Check,
  ChevronRight,
  Users,
  CalendarDays,
} from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getMisRetos, getWallet, saveDatosBancarios } from "@/app/retoActions";
import type { Reto, WalletResumen, DatosBancarios } from "@/lib/types";

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/40" },
  publicado: { label: "Publicado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
  en_curso: { label: "En curso", cls: "bg-primary/15 text-primary border-primary/40" },
  finalizado: { label: "Finalizado", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
};

function monto(n: number, moneda: string): string {
  return moneda === "USD" ? `USD ${n.toLocaleString("es-CO")}` : `$${n.toLocaleString("es-CO")}`;
}

export default function MisRetosPage() {
  const router = useRouter();
  const { token, loading: authLoading } = useRequireAuth();
  const [retos, setRetos] = useState<Reto[] | null>(null);
  const [wallet, setWallet] = useState<WalletResumen | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [r, w] = await Promise.all([getMisRetos(token), getWallet(token)]);
    setRetos(r);
    setWallet(w);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading || retos === null) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Trophy className="w-8 h-8 text-primary" /> Mis Retos
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Crea retos de aprendizaje verificado para tu audiencia y gana el 80% de cada entrada.
            </p>
          </div>
          <button
            onClick={() => router.push("/retos/nuevo")}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors shrink-0"
          >
            <Plus className="w-5 h-5" /> Crear reto
          </button>
        </div>

        {/* Lista de retos */}
        {retos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center mb-10">
            <Trophy className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400 mb-1 font-semibold">Aún no tienes retos.</p>
            <p className="text-zinc-500 text-sm">
              Crea tu primer reto: montamos la ruta con IA y tú defines los premios.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-10">
            {retos.map(r => {
              const badge = ESTADO_BADGE[r.estadoEfectivo] ?? ESTADO_BADGE.borrador;
              return (
                <button
                  key={r.id}
                  onClick={() => router.push(`/retos/${r.id}`)}
                  className="w-full flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-left hover:border-primary/50 transition-colors"
                >
                  {r.imagenUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imagenUrl} alt="" className="w-24 h-14 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-24 h-14 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                      <Trophy className="w-6 h-6 text-zinc-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h2 className="font-bold truncate">{r.titulo}</h2>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold border ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {r.rutaStatus === "generating" && (
                        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-zinc-400">
                          <Loader2 className="w-3 h-3 animate-spin" /> Generando ruta
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Trophy className="w-3.5 h-3.5" /> {r.premios.length} {r.premios.length === 1 ? "premio" : "premios"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> {r.cuposGratisUsados}/{r.cuposGratisTotales} cupos usados
                      </span>
                      {r.fechaFin && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3.5 h-3.5" />
                          Cierra {new Date(r.fechaFin).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-500 shrink-0" />
                </button>
              );
            })}
          </div>
        )}

        {/* Wallet */}
        <WalletSection token={token!} wallet={wallet} onSaved={load} />
      </div>
    </main>
  );
}

function WalletSection({ token, wallet, onSaved }: { token: string; wallet: WalletResumen | null; onSaved: () => void }) {
  const [editBanca, setEditBanca] = useState(false);
  const [banca, setBanca] = useState<DatosBancarios>({ titular: "", documento: "", banco: "", tipoCuenta: "ahorros", numero: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet?.datosBancarios) setBanca(wallet.datosBancarios);
  }, [wallet]);

  const guardar = async () => {
    setSaving(true);
    setError(null);
    const res = await saveDatosBancarios(token, banca);
    setSaving(false);
    if (!res.ok) return setError(res.error || "No se pudo guardar.");
    setSaved(true);
    setEditBanca(false);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  };

  return (
    <section>
      <h2 className="flex items-center gap-2 text-xl font-bold mb-4">
        <Wallet className="w-6 h-6 text-primary" /> Tu wallet
      </h2>
      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Saldo disponible</p>
          <p className="text-3xl font-bold text-emerald-400">
            {monto(wallet?.saldoDisponible ?? 0, wallet?.moneda ?? "COP")}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">El payout se coordina manualmente con el equipo.</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Total acreditado (80%)</p>
          <p className="text-3xl font-bold">{monto(wallet?.totalAcreditado ?? 0, wallet?.moneda ?? "COP")}</p>
          <p className="text-[11px] text-zinc-500 mt-1">{wallet?.movimientos.length ?? 0} movimientos en total.</p>
        </div>
      </div>

      {/* Movimientos */}
      {wallet && wallet.movimientos.length > 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden mb-5">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
            <span>Reto / participante</span>
            <span className="text-right">Bruto</span>
            <span className="text-right">Tu 80%</span>
            <span className="text-right">Estado</span>
          </div>
          {wallet.movimientos.slice(0, 30).map(m => (
            <div key={m.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-3 text-sm border-b border-zinc-800/60 last:border-0">
              <div className="min-w-0">
                <p className="font-semibold truncate">{m.retoTitulo}</p>
                <p className="text-xs text-zinc-500 truncate">
                  {m.participante ?? "Participante"} · {new Date(m.fecha).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </div>
              <span className="text-right text-zinc-400">{monto(m.montoBruto, m.moneda)}</span>
              <span className="text-right font-bold text-emerald-400">{monto(m.montoCreador, m.moneda)}</span>
              <span className={`text-right text-xs font-semibold ${m.estado === "liquidado" ? "text-zinc-500" : "text-emerald-400"}`}>
                {m.estado === "liquidado" ? "Liquidado" : "Disponible"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Datos bancarios */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="flex items-center gap-2 font-bold text-sm">
            <Landmark className="w-4 h-4 text-primary" /> Datos bancarios de payout
          </h3>
          {!editBanca && (
            <button onClick={() => setEditBanca(true)} className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors">
              {wallet?.datosBancarios ? "Editar" : "Agregar"}
            </button>
          )}
        </div>
        {!editBanca ? (
          wallet?.datosBancarios ? (
            <p className="text-sm text-zinc-400">
              {wallet.datosBancarios.titular} · {wallet.datosBancarios.banco} ·{" "}
              {wallet.datosBancarios.tipoCuenta === "ahorros" ? "Ahorros" : "Corriente"} ·{" "}
              ****{wallet.datosBancarios.numero.slice(-4)}
            </p>
          ) : (
            <p className="text-sm text-zinc-500">Agrega tu cuenta para recibir los payouts.</p>
          )
        ) : (
          <div className="space-y-2.5 mt-3">
            <div className="grid sm:grid-cols-2 gap-2.5">
              <input
                value={banca.titular}
                onChange={e => setBanca({ ...banca, titular: e.target.value })}
                placeholder="Titular de la cuenta"
                className="rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary"
              />
              <input
                value={banca.documento}
                onChange={e => setBanca({ ...banca, documento: e.target.value })}
                placeholder="Documento del titular"
                className="rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary"
              />
              <input
                value={banca.banco}
                onChange={e => setBanca({ ...banca, banco: e.target.value })}
                placeholder="Banco"
                className="rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary"
              />
              <input
                value={banca.numero}
                onChange={e => setBanca({ ...banca, numero: e.target.value })}
                placeholder="Número de cuenta"
                className="rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2">
              {(["ahorros", "corriente"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setBanca({ ...banca, tipoCuenta: t })}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    banca.tipoCuenta === t
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-zinc-800/60 text-zinc-400 border-zinc-700"
                  }`}
                >
                  {t === "ahorros" ? "Ahorros" : "Corriente"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={guardar}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
                Guardar
              </button>
              <button onClick={() => setEditBanca(false)} className="px-4 py-2.5 text-sm text-zinc-400 hover:text-white transition-colors">
                Cancelar
              </button>
            </div>
            {error && <p className="text-rose-400 text-sm">{error}</p>}
            <p className="text-[11px] text-zinc-500">
              Estos datos se guardan de forma segura y solo los ve el equipo para hacer tu payout.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
