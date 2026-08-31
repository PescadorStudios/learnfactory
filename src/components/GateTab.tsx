"use client";

// Pestaña "Muro" del panel de admin. Responde dos preguntas que no se pueden
// contestar a ojo: ¿son 5 unidades y 4 horas los números correctos?, y ¿el muro
// convierte de verdad? Sin esto, ajustar el freemium sería adivinar.

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Hourglass, Crown, TrendingUp, AlertTriangle } from "lucide-react";
import { adminGateMetrics, type GateMetrics } from "@/app/adminActions";

const KIND_LABEL: Record<string, string> = {
  lesson: "Lecciones",
  podcast: "Podcast",
  corto: "Modo Scroll",
  tunel: "Túnel",
  lectura: "Lectura Veloz",
};

function Stat({
  label,
  value,
  hint,
  accent = "text-white",
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      {hint && <p className="text-xs text-zinc-600 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

export default function GateTab({ token }: { token: string }) {
  const [m, setM] = useState<GateMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setM(await adminGateMetrics(token));
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !m) {
    return (
      <div className="flex items-center justify-center gap-2 text-zinc-500 py-24">
        <Loader2 className="w-5 h-5 animate-spin" /> Cargando métricas...
      </div>
    );
  }

  if (!m) return <p className="text-zinc-500 py-12">No se pudieron cargar las métricas.</p>;

  if (!m.tablesReady) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-6 flex gap-4">
        <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
        <div>
          <h3 className="font-bold text-white mb-1">Falta correr la migración del muro</h3>
          <p className="text-sm text-zinc-400">
            Las tablas <code className="text-amber-300">study_sessions</code> y{" "}
            <code className="text-amber-300">study_units</code> no existen todavía. Corre{" "}
            <code className="text-amber-300">scripts/session-wall-setup.sql</code> en Supabase
            (SQL Editor) o con <code className="text-amber-300">node scripts/apply-sql.mjs scripts/session-wall-setup.sql</code>.
          </p>
          <p className="text-xs text-zinc-500 mt-2">
            Mientras no exista, nadie queda bloqueado: el muro falla &quot;en abierto&quot; a propósito.
          </p>
        </div>
      </div>
    );
  }

  const totalUnits = m.byKind.reduce((s, k) => s + k.units, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-500">
          Tope actual: <span className="text-white font-bold">{m.budget}</span> unidades por sesión
          {m.budget > 20 && (
            <span className="ml-2 text-amber-400">
              (modo observación — el muro no está apretando)
            </span>
          )}
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Actualizar
        </button>
      </div>

      {/* Hoy */}
      <div>
        <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-500 mb-3">Hoy</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Sesiones abiertas" value={m.sessionsToday} />
          <Stat label="Bloqueos" value={m.locksToday} accent="text-amber-400" />
          <Stat
            label="Bloqueados ahora"
            value={m.lockedNow}
            hint="Con el reloj corriendo"
            accent="text-amber-400"
          />
          <Stat
            label="Mediana de unidades"
            value={m.medianUnits}
            hint={`De ${m.budget} disponibles (30 días)`}
          />
        </div>
      </div>

      {/* Conversión */}
      <div>
        <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-500 mb-3">
          Conversión (últimos 30 días)
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Sesiones" value={m.sessions30d} />
          <Stat label="Bloqueos" value={m.locks30d} accent="text-amber-400" />
          <Stat
            label="Pagaron tras bloqueo"
            value={m.locksConvertedIn48h}
            hint="Dentro de 48 h"
            accent="text-emerald-400"
          />
          <Stat
            label="Tasa de conversión"
            value={`${m.conversionPct}%`}
            hint="Bloqueo → pago"
            accent="text-emerald-400"
          />
        </div>
        {m.locks30d > 0 && m.conversionPct === 0 && (
          <p className="text-xs text-zinc-500 mt-3 flex items-start gap-2">
            <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Hay bloqueos pero ninguna compra todavía. Si se mantiene, el problema suele ser el
            precio, el momento del muro o el copy — no la cantidad de bloqueos.
          </p>
        )}
      </div>

      {/* Consumo por modo */}
      <div>
        <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-500 mb-3">
          Unidades por modo (30 días)
        </h3>
        {m.byKind.length === 0 ? (
          <p className="text-sm text-zinc-600">Todavía no se ha consumido ninguna unidad.</p>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
            {m.byKind.map(k => {
              const pct = totalUnits ? Math.round((k.units / totalUnits) * 100) : 0;
              return (
                <div key={k.kind}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-zinc-300 font-medium">{KIND_LABEL[k.kind] ?? k.kind}</span>
                    <span className="text-zinc-500">
                      {k.units} <span className="text-zinc-600">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Membresías */}
      <div>
        <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-500 mb-3">Membresías</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Activas" value={m.membersActive} accent="text-amber-400" />
          <Stat
            label="Fundadores"
            value={m.founders}
            hint="Pago único, de por vida"
            accent="text-violet-400"
          />
          <Stat
            label="Vencen en 7 días"
            value={m.expiringIn7d}
            hint="Reciben recordatorio a 3 días"
          />
          <Stat label="Vencidas" value={m.lapsed} hint="Candidatas a recuperar" />
        </div>
      </div>

      <p className="text-xs text-zinc-600 flex items-start gap-2 pt-2">
        <Hourglass className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Los correos de desbloqueo y de renovación los manda{" "}
        <code className="text-zinc-500">/api/membership/worker</code> cada 5 minutos (cron de Vercel).
        Necesita <code className="text-zinc-500">CRON_SECRET</code>,{" "}
        <code className="text-zinc-500">RESEND_API_KEY</code> y{" "}
        <code className="text-zinc-500">EMAIL_FROM</code>.
      </p>
      <p className="text-xs text-zinc-600 flex items-start gap-2">
        <Crown className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        La renovación es MANUAL: Bold no tiene API de suscripciones, así que el ingreso recurrente
        depende de esos recordatorios.
      </p>
    </div>
  );
}
