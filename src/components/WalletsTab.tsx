"use client";

// Tab del admin: billeteras de los creadores de retos. Muestra saldo (80%),
// movimientos y datos bancarios de payout; el admin marca "liquidado" cuando
// hace el pago manual por fuera. La plataforma se queda con el 20%.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Wallet, Check, Undo2, Landmark, ChevronDown, ChevronUp, BadgeCheck } from "lucide-react";
import {
  adminListWallets,
  adminMarkMovimientoLiquidado,
  adminLiquidarCreador,
  type AdminWalletCreador,
} from "@/app/adminActions";

function monto(n: number, moneda: string): string {
  return moneda === "USD" ? `USD ${n.toLocaleString("es-CO")}` : `$${n.toLocaleString("es-CO")}`;
}

export default function WalletsTab({ token }: { token: string }) {
  const [wallets, setWallets] = useState<AdminWalletCreador[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setWallets(await adminListWallets(token));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleMovimiento = async (movId: string, liquidado: boolean) => {
    setBusyId(movId);
    await adminMarkMovimientoLiquidado(token, movId, liquidado);
    await load();
    setBusyId(null);
  };

  const liquidarTodo = async (creadorId: string) => {
    setBusyId(creadorId);
    await adminLiquidarCreador(token, creadorId);
    await load();
    setBusyId(null);
  };

  if (wallets === null) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!wallets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center">
        <Wallet className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
        <p className="text-zinc-400 font-semibold">Sin movimientos de retos todavía.</p>
        <p className="text-zinc-500 text-sm mt-1">Cuando un participante pague la entrada a un reto, el 80% aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {wallets.map(w => {
        const abierto = open === w.creadorId;
        return (
          <div key={w.creadorId} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => setOpen(abierto ? null : w.creadorId)}
              className="w-full flex items-center gap-4 p-4 text-left hover:bg-zinc-900 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{w.nombre || w.email}</p>
                <p className="text-xs text-zinc-500 truncate">{w.email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-emerald-400">{monto(w.saldoDisponible, w.moneda)}</p>
                <p className="text-[11px] text-zinc-500">por liquidar · total {monto(w.totalAcreditado, w.moneda)}</p>
              </div>
              {abierto ? <ChevronUp className="w-5 h-5 text-zinc-500 shrink-0" /> : <ChevronDown className="w-5 h-5 text-zinc-500 shrink-0" />}
            </button>

            {abierto && (
              <div className="border-t border-zinc-800 p-4 space-y-4">
                {/* Datos bancarios (sensibles: solo visibles aquí, al admin) */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    <Landmark className="w-3.5 h-3.5" /> Datos de payout
                  </p>
                  {w.banca ? (
                    <p className="text-sm text-zinc-300">
                      {w.banca.titular} · Doc. {w.banca.documento} · {w.banca.banco} ·{" "}
                      {w.banca.tipoCuenta === "corriente" ? "Corriente" : "Ahorros"} · {w.banca.numero}
                    </p>
                  ) : (
                    <p className="text-sm text-zinc-500">El creador aún no registró sus datos bancarios.</p>
                  )}
                </div>

                {w.saldoDisponible > 0 && (
                  <button
                    onClick={() => liquidarTodo(w.creadorId)}
                    disabled={busyId === w.creadorId}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition-colors disabled:opacity-60"
                  >
                    {busyId === w.creadorId ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                    Marcar todo liquidado ({monto(w.saldoDisponible, w.moneda)})
                  </button>
                )}

                <div className="space-y-1.5">
                  {w.movimientos.map(m => (
                    <div key={m.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{m.retoTitulo}</p>
                        <p className="text-[11px] text-zinc-500">
                          {new Date(m.fecha).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })} · bruto{" "}
                          {monto(m.montoBruto, m.moneda)} · plataforma {monto(m.montoPlataforma, m.moneda)}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-emerald-400 shrink-0">{monto(m.montoCreador, m.moneda)}</span>
                      <button
                        onClick={() => toggleMovimiento(m.id, m.estado !== "liquidado")}
                        disabled={busyId === m.id}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors shrink-0 disabled:opacity-60 ${
                          m.estado === "liquidado"
                            ? "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                        }`}
                      >
                        {busyId === m.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : m.estado === "liquidado" ? (
                          <Undo2 className="w-3.5 h-3.5" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        {m.estado === "liquidado" ? "Liquidado" : "Liquidar"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
