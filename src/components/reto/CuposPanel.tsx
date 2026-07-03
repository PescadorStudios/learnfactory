"use client";

// Panel de cupos gratis del creador: generar códigos (hasta el tope), verlos,
// copiarlos (individual o todos) y ver quién canjeó cada uno.

import { useState } from "react";
import { Ticket, Copy, Check, Loader2, Gift } from "lucide-react";
import { generateCupos } from "@/app/retoActions";
import type { RetoCupo } from "@/lib/types";

export default function CuposPanel({
  token,
  retoId,
  cupos,
  totales,
  onRefresh,
}: {
  token: string;
  retoId: string;
  cupos: RetoCupo[];
  totales: number;
  onRefresh: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const restantes = totales - cupos.length;
  const canjeados = cupos.filter(c => c.estado === "canjeado").length;

  const generar = async () => {
    setGenerating(true);
    setError(null);
    const res = await generateCupos(token, retoId, restantes);
    setGenerating(false);
    if (!res.ok) return setError(res.error || "No se pudieron generar los cupos.");
    onRefresh();
  };

  const copiar = (codigo: string, id: string) => {
    navigator.clipboard.writeText(codigo);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copiarTodos = () => {
    navigator.clipboard.writeText(cupos.filter(c => c.estado === "disponible").map(c => c.codigo).join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="flex items-center gap-2 font-bold">
          <Ticket className="w-5 h-5 text-primary" /> Cupos gratis
        </h3>
        <span className="text-xs text-zinc-400">
          {canjeados} canjeados · {cupos.length}/{totales} generados
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-4 flex items-center gap-1.5">
        <Gift className="w-3.5 h-3.5" /> Regala o sortea estos códigos entre tus seguidores para que prueben el reto gratis.
      </p>

      {cupos.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {cupos.map(c => (
            <div
              key={c.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                c.estado === "canjeado" ? "border-zinc-800 bg-zinc-900/30 opacity-60" : "border-zinc-700 bg-zinc-800/50"
              }`}
            >
              <code className="font-mono text-sm font-semibold tracking-wider">{c.codigo}</code>
              <div className="flex-1 text-right text-xs">
                {c.estado === "canjeado" ? (
                  <span className="text-amber-400">
                    Canjeado{c.canjeadoPor ? ` por ${c.canjeadoPor}` : ""}
                    {c.fechaCanje
                      ? ` · ${new Date(c.fechaCanje).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}`
                      : ""}
                  </span>
                ) : (
                  <span className="text-emerald-400">Disponible</span>
                )}
              </div>
              {c.estado === "disponible" && (
                <button
                  onClick={() => copiar(c.codigo, c.id)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    copiedId === c.id ? "text-emerald-400" : "text-zinc-400 hover:text-white hover:bg-zinc-700"
                  }`}
                  title="Copiar código"
                >
                  {copiedId === c.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {restantes > 0 && (
          <button
            onClick={generar}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
            Generar {restantes} {restantes === 1 ? "cupo" : "cupos"}
          </button>
        )}
        {cupos.some(c => c.estado === "disponible") && (
          <button
            onClick={copiarTodos}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              copiedAll
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                : "border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedAll ? "Copiados" : "Copiar disponibles"}
          </button>
        )}
      </div>
      {error && <p className="text-rose-400 text-sm mt-3">{error}</p>}
    </div>
  );
}
