"use client";

// Editor de la lista ordenada de premios de un reto. Controlado: recibe la
// lista y notifica cambios; la persistencia la hace el padre (setRetoPremios).
// Posición 1 = premio mayor; la cantidad de premios define la de ganadores.

import { Plus, Trash2, ChevronUp, ChevronDown, Crown } from "lucide-react";
import { PREMIO_TIPOS, type PremioTipo } from "@/lib/types";

export interface PremioDraft {
  titulo: string;
  descripcion: string;
  tipo: PremioTipo;
}

export default function PremiosEditor({
  premios,
  onChange,
  disabled,
}: {
  premios: PremioDraft[];
  onChange: (premios: PremioDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<PremioDraft>) => {
    onChange(premios.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= premios.length) return;
    const next = [...premios];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {premios.map((p, i) => (
        <div key={i} className={`rounded-2xl border p-4 ${i === 0 ? "border-primary/50 bg-primary/5" : "border-zinc-800 bg-zinc-900/50"}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${i === 0 ? "bg-primary/20 text-primary" : "bg-zinc-800 text-zinc-300"}`}>
              {i === 0 ? <Crown className="w-3.5 h-3.5" /> : null}
              {i === 0 ? "Premio mayor" : `Premio ${i + 1}`}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => move(i, -1)}
              disabled={disabled || i === 0}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 transition-colors"
              title="Subir"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={disabled || i === premios.length - 1}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 transition-colors"
              title="Bajar"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              onClick={() => onChange(premios.filter((_, idx) => idx !== i))}
              disabled={disabled}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 transition-colors"
              title="Eliminar"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2.5">
            <input
              value={p.titulo}
              onChange={e => update(i, { titulo: e.target.value })}
              disabled={disabled}
              maxLength={140}
              placeholder={i === 0 ? 'Ej. "Mentoría 1 a 1 de 60 minutos"' : 'Ej. "Aparición en mi próximo video"'}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary disabled:opacity-60"
            />
            <textarea
              value={p.descripcion}
              onChange={e => update(i, { descripcion: e.target.value })}
              disabled={disabled}
              rows={2}
              placeholder="Detalle del premio (opcional)"
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary resize-none disabled:opacity-60"
            />
            <div className="flex flex-wrap gap-1.5">
              {PREMIO_TIPOS.map(t => (
                <button
                  key={t.id}
                  onClick={() => update(i, { tipo: t.id })}
                  disabled={disabled}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-60 ${
                    p.tipo === t.id
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-zinc-800/60 text-zinc-400 border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={() => onChange([...premios, { titulo: "", descripcion: "", tipo: "mentoria" }])}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-zinc-700 text-sm font-semibold text-zinc-400 hover:text-white hover:border-primary/60 transition-colors disabled:opacity-40"
      >
        <Plus className="w-4 h-4" /> Añadir premio
      </button>
      <p className="text-xs text-zinc-500">
        Habrá tantos ganadores como premios: el primero en completar la ruta verificada gana el premio mayor, el segundo el
        premio 2, y así sucesivamente.
      </p>
    </div>
  );
}
