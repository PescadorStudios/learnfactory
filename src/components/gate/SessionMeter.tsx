"use client";

// Medidor de la sesión: "3 de 5 de esta sesión". Su función es de ENGANCHE, no
// informativa: ver la bolsa bajar crea consciencia de escasez antes del muro, y
// el aviso en ámbar de la última unidad prepara el momento de conversión.
//
// La barra copia la receta de src/components/ReputationBadge.tsx:108-113 (no hay
// componente <Progress> en el proyecto).

import type { GateState } from "@/lib/types";

/** Con topes muy altos (despliegue en modo observación) el medidor no aporta. */
const MAX_BUDGET_TO_SHOW = 20;

export default function SessionMeter({
  gate,
  className = "",
}: {
  gate: GateState | null;
  className?: string;
}) {
  // Los miembros y fundadores no tienen bolsa que mirar.
  if (!gate || gate.unlimited || gate.walled) return null;
  if (gate.budget > MAX_BUDGET_TO_SHOW) return null;

  const used = Math.min(gate.unitsUsed, gate.budget);
  const pct = gate.budget > 0 ? Math.min(100, Math.round((used / gate.budget) * 100)) : 0;
  const last = gate.remaining === 1;

  return (
    <div className={`w-full max-w-[180px] ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500">
          Esta sesión
        </span>
        <span className={`text-[11px] font-bold ${last ? "text-amber-400" : "text-zinc-400"}`}>
          {used} de {gate.budget}
        </span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            last ? "bg-amber-500" : "bg-gradient-to-r from-primary to-secondary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {last && (
        <p className="text-[10px] text-amber-400/90 mt-1 leading-tight">
          Te queda 1 en esta sesión
        </p>
      )}
    </div>
  );
}
