"use client";

// Insignias del sistema de reputación de dos vías.
// - <RankPill />  : píldora compacta (listas, tarjetas, junto a nombres).
// - <RankCard />  : tarjeta grande con el camino completo de 5 medallas,
//                   barra de progreso y lo que falta para el siguiente rango
//                   (goal gradient: la meta siempre visible y concreta).

import { Compass, Hammer, Lock, Crown } from "lucide-react";
import type { RankDef, RankProgress } from "@/lib/reputation";
import { EXPLORER_RANKS, CREATOR_RANKS } from "@/lib/reputation";

export type Track = "explorer" | "creator";

/** Estilos por tier: del gris de inicio al legendario con glow. */
const TIER_STYLE: Record<RankDef["tier"], { text: string; bg: string; border: string; medal: string; glow: string }> = {
  zinc: { text: "text-zinc-400", bg: "bg-zinc-800/80", border: "border-zinc-700", medal: "bg-zinc-800 border-zinc-600 text-zinc-400", glow: "" },
  bronze: { text: "text-amber-600", bg: "bg-amber-600/10", border: "border-amber-700/50", medal: "bg-amber-600/15 border-amber-600/60 text-amber-500", glow: "" },
  silver: { text: "text-zinc-200", bg: "bg-zinc-400/10", border: "border-zinc-400/50", medal: "bg-zinc-400/15 border-zinc-300/60 text-zinc-200", glow: "" },
  gold: { text: "text-amber-300", bg: "bg-amber-400/10", border: "border-amber-400/50", medal: "bg-amber-400/15 border-amber-400/70 text-amber-300", glow: "shadow-[0_0_18px_rgba(251,191,36,0.25)]" },
  legend: { text: "text-violet-300", bg: "bg-violet-500/15", border: "border-violet-400/60", medal: "bg-violet-500/20 border-violet-400/80 text-violet-300", glow: "shadow-[0_0_28px_rgba(139,92,246,0.45)]" },
};

function TrackIcon({ track, className }: { track: Track; className?: string }) {
  return track === "explorer" ? <Compass className={className} /> : <Hammer className={className} />;
}

/** Píldora compacta: icono de la vía + nombre del rango, en su color. */
export function RankPill({ track, rank, size = "sm" }: { track: Track; rank: RankDef; size?: "xs" | "sm" }) {
  const s = TIER_STYLE[rank.tier];
  const cls = size === "xs" ? "text-[10px] px-1.5 py-px gap-1" : "text-xs px-2.5 py-0.5 gap-1.5";
  const icon = size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3";
  return (
    <span className={`inline-flex items-center rounded-full border font-bold ${cls} ${s.text} ${s.bg} ${s.border} ${rank.tier === "legend" ? s.glow : ""}`}>
      <TrackIcon track={track} className={icon} />
      {rank.name}
    </span>
  );
}

/**
 * Tarjeta grande de una vía: medalla actual, camino de 5 rangos (las
 * bloqueadas en gris — la colección incompleta llama a completarse),
 * barra de progreso y el "te falta X" concreto.
 */
export function RankCard({
  track,
  progress,
  statLabel,
}: {
  track: Track;
  progress: RankProgress;
  /** Línea de stat principal, ej: "12 rutas completadas · 4.2★ de media". */
  statLabel: string;
}) {
  const { rank, next, pct, missingLabel } = progress;
  const s = TIER_STYLE[rank.tier];
  const ranks = track === "explorer" ? EXPLORER_RANKS : CREATOR_RANKS;
  const title = track === "explorer" ? "Explorador" : "Creador";

  return (
    <div className={`bg-zinc-900/80 border rounded-2xl p-5 ${s.border} ${rank.tier === "legend" ? s.glow : ""}`}>
      <div className="flex items-center gap-4 mb-4">
        {/* Medalla actual */}
        <div className={`w-14 h-14 shrink-0 rounded-2xl border-2 flex items-center justify-center ${s.medal} ${s.glow}`}>
          <TrackIcon track={track} className="w-7 h-7" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest font-bold text-zinc-500">{title}</p>
          <p className={`text-xl font-bold leading-tight ${s.text}`}>{rank.name}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{statLabel}</p>
        </div>
        {rank.level === 5 && <Crown className="w-6 h-6 text-violet-300 ml-auto shrink-0" />}
      </div>

      {/* Camino completo: 5 medallas, las bloqueadas en gris */}
      <div className="flex items-center gap-1.5 mb-4">
        {ranks.map((r, i) => {
          const unlocked = r.level <= rank.level;
          const rs = TIER_STYLE[r.tier];
          return (
            <div key={r.level} className="flex-1 flex items-center gap-1.5">
              <div
                title={r.name}
                className={`w-8 h-8 shrink-0 rounded-full border flex items-center justify-center transition-all ${
                  unlocked ? `${rs.medal} ${r.level === rank.level ? "scale-110 " + rs.glow : ""}` : "bg-zinc-900 border-zinc-800 text-zinc-700"
                }`}
              >
                {unlocked ? <TrackIcon track={track} className="w-3.5 h-3.5" /> : <Lock className="w-3 h-3" />}
              </div>
              {i < ranks.length - 1 && (
                <div className={`flex-1 h-0.5 rounded ${r.level < rank.level ? "bg-zinc-500" : "bg-zinc-800"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Progreso hacia el siguiente rango (goal gradient) */}
      {next ? (
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-zinc-500">
              Siguiente: <span className={TIER_STYLE[next.tier].text + " font-bold"}>{next.name}</span>
            </span>
            <span className="text-zinc-500 font-bold">{pct}%</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all duration-700"
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          </div>
          {missingLabel && (
            <p className="text-xs text-zinc-400 mt-2">
              Te {missingLabel.startsWith("1 ") && !missingLabel.includes(" y ") ? "falta" : "faltan"} <span className="text-white font-bold">{missingLabel}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-violet-300 font-bold flex items-center gap-1.5">
          <Crown className="w-3.5 h-3.5" /> Rango máximo alcanzado. Eres leyenda viva de LearnFactory.
        </p>
      )}
    </div>
  );
}
