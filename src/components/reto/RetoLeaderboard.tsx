"use client";

// Leaderboard del dashboard del creador: % de avance VERIFICADO, ganadores
// marcados con su premio y si cada participante entró por pago o por cupo.

import { Crown, Ticket, CreditCard } from "lucide-react";
import type { RetoLeaderboardEntry } from "@/lib/types";

export default function RetoLeaderboard({ entries }: { entries: RetoLeaderboardEntry[] }) {
  if (!entries.length) {
    return <p className="text-zinc-500 text-sm">Aún no hay participantes inscritos.</p>;
  }
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <div
          key={`${e.nombre}-${i}`}
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
            e.premioPosicion != null ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/50"
          }`}
        >
          <span className="w-8 text-center font-bold text-zinc-400 shrink-0">
            {e.premioPosicion != null ? <Crown className="w-4 h-4 text-amber-400 mx-auto" /> : `#${i + 1}`}
          </span>
          {e.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs text-zinc-400 font-bold shrink-0">
              {e.nombre[0]?.toUpperCase()}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{e.nombre}</p>
            {e.premioPosicion != null && e.premioTitulo ? (
              <p className="text-xs text-amber-400 truncate">
                Premio {e.premioPosicion}: {e.premioTitulo}
              </p>
            ) : e.finalizadoAt ? (
              <p className="text-xs text-emerald-400">
                Completado el {new Date(e.finalizadoAt).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
              </p>
            ) : null}
          </div>
          {e.via && (
            <span
              className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${
                e.via === "cupo"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border-zinc-700"
              }`}
            >
              {e.via === "cupo" ? <Ticket className="w-3 h-3" /> : <CreditCard className="w-3 h-3" />}
              {e.via === "cupo" ? "Cupo" : "Pago"}
            </span>
          )}
          <div className="w-28 shrink-0">
            <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
              <span>{e.finalizadoAt ? "Verificado" : "Avance"}</span>
              <span className="font-bold text-zinc-200">{e.completionPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${e.finalizadoAt ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${e.completionPct}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
