"use client";

// Vocabulario VISUAL CERRADO del Modo Scroll. Una composición React/Framer-Motion
// por cada componente que el Director (scrollDirector.ts) puede elegir, con la
// MISMA firma de props que produce. Doble codificación: cada componente
// representa visualmente una clase de idea (comparación, proceso, cantidad...).
//
// Diseñados "bake-ready": deterministas dados (props, durationMs) → un futuro
// horneado a MP4 (Remotion) podría reutilizar exactamente estas composiciones.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { ComponenteScroll } from "@/lib/types";

export interface VocabProps {
  props: Record<string, unknown>;
  /** Duración del cue en ms (para pacing de animaciones tipo contador/barra). */
  durationMs: number;
}

// ── Coerción defensiva (la salida del LLM puede variar de forma) ──
const asStr = (v: unknown, fb = ""): string => (typeof v === "string" ? v : v == null ? fb : String(v));
const asNum = (v: unknown, fb = 0): number => {
  if (typeof v === "number" && isFinite(v)) return v;
  const n = parseFloat(String(v));
  return isFinite(n) ? n : fb;
};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStrArr = (v: unknown): string[] => asArr(v).map(x => asStr(x)).filter(Boolean);
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
};

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** Contenedor a pantalla completa, vertical, con crossfade de entrada/salida. */
function Shell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={`absolute inset-0 flex flex-col justify-center px-7 ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {children}
    </motion.div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="text-fuchsia-400 text-xs font-bold uppercase tracking-[0.2em] mb-4"
    >
      {children}
    </motion.p>
  );
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};
const itemUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

// ── Componentes ──────────────────────────────────────────────────────────────

function TermCallout({ props }: VocabProps) {
  const termino = asStr(pick(props, "termino", "term", "titulo"));
  const definicion = asStr(pick(props, "definicion", "definition", "texto"));
  return (
    <Shell>
      <Kicker>Concepto</Kicker>
      <motion.h2
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
        className="text-5xl font-black leading-[1.05] mb-5 text-white"
      >
        {termino}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.4 }}
        className="text-2xl text-zinc-300 leading-snug"
      >
        {definicion}
      </motion.p>
    </Shell>
  );
}

function BuildList({ props }: VocabProps) {
  const titulo = asStr(pick(props, "titulo", "title"));
  const items = asStrArr(pick(props, "items", "puntos", "elementos")).slice(0, 6);
  return (
    <Shell>
      {titulo && (
        <motion.h2
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
          className="text-3xl font-black mb-6 text-white leading-tight"
        >
          {titulo}
        </motion.h2>
      )}
      <motion.ul variants={stagger} initial="hidden" animate="show" className="space-y-3.5">
        {items.map((it, i) => (
          <motion.li key={i} variants={itemUp} className="flex items-start gap-3">
            <span className="mt-1 shrink-0 w-6 h-6 rounded-full bg-fuchsia-500/20 text-fuchsia-300 text-sm font-bold flex items-center justify-center">{i + 1}</span>
            <span className="text-xl text-zinc-200 leading-snug">{it}</span>
          </motion.li>
        ))}
      </motion.ul>
    </Shell>
  );
}

function versusSide(v: unknown) {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { titulo: asStr(pick(o, "titulo", "title")), puntos: asStrArr(pick(o, "puntos", "points", "items")).slice(0, 4) };
}

function VersusColumn({ titulo, puntos, accent, delay }: { titulo: string; puntos: string[]; accent: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay }}
      className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4"
    >
      <p className={`text-lg font-black mb-3 ${accent}`}>{titulo}</p>
      <ul className="space-y-2">
        {puntos.map((p, i) => <li key={i} className="text-base text-zinc-300 leading-snug">{p}</li>)}
      </ul>
    </motion.div>
  );
}

function VersusSplit({ props }: VocabProps) {
  const izq = versusSide(pick(props, "izquierda", "left", "a"));
  const der = versusSide(pick(props, "derecha", "right", "b"));
  return (
    <Shell>
      <Kicker>Comparación</Kicker>
      <div className="flex items-stretch gap-3">
        <VersusColumn titulo={izq.titulo} puntos={izq.puntos} accent="text-cyan-300" delay={0.1} />
        <div className="flex items-center text-zinc-600 font-black text-xl">vs</div>
        <VersusColumn titulo={der.titulo} puntos={der.puntos} accent="text-fuchsia-300" delay={0.25} />
      </div>
    </Shell>
  );
}

function Timeline({ props }: VocabProps) {
  const hitos = asArr(pick(props, "hitos", "eventos", "items")).map(h => {
    const o = h && typeof h === "object" ? (h as Record<string, unknown>) : {};
    return { etiqueta: asStr(pick(o, "etiqueta", "label", "titulo") ?? h), detalle: asStr(pick(o, "detalle", "detail", "descripcion")) };
  }).slice(0, 5);
  return (
    <Shell>
      <Kicker>Línea de tiempo</Kicker>
      <motion.ol variants={stagger} initial="hidden" animate="show" className="relative pl-7">
        <div className="absolute left-[9px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-fuchsia-500/60 to-violet-500/20" />
        {hitos.map((h, i) => (
          <motion.li key={i} variants={itemUp} className="relative mb-5 last:mb-0">
            <span className="absolute -left-7 top-1 w-[18px] h-[18px] rounded-full bg-fuchsia-500 border-4 border-zinc-950" />
            <p className="text-xl font-bold text-white leading-tight">{h.etiqueta}</p>
            {h.detalle && <p className="text-base text-zinc-400 mt-0.5">{h.detalle}</p>}
          </motion.li>
        ))}
      </motion.ol>
    </Shell>
  );
}

function NodeGraph({ props }: VocabProps) {
  const raiz = asStr(pick(props, "raiz", "root", "centro", "titulo"));
  const ramas = asStrArr(pick(props, "ramas", "branches", "hijos", "items")).slice(0, 5);
  return (
    <Shell className="items-center text-center">
      <Kicker>Relaciones</Kicker>
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45 }}
        className="px-6 py-3 rounded-2xl bg-fuchsia-500/20 border border-fuchsia-500/50 text-2xl font-black text-white mb-5"
      >
        {raiz}
      </motion.div>
      <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-wrap justify-center gap-2.5 max-w-md">
        {ramas.map((r, i) => (
          <motion.span key={i} variants={itemUp} className="px-4 py-2 rounded-xl bg-zinc-900/70 border border-zinc-800 text-lg text-zinc-200">
            {r}
          </motion.span>
        ))}
      </motion.div>
    </Shell>
  );
}

function Counter({ props, durationMs }: VocabProps) {
  const valor = asNum(pick(props, "valor", "value", "numero"));
  const sufijo = asStr(pick(props, "sufijo", "suffix", "unidad"));
  const etiqueta = asStr(pick(props, "etiqueta", "label", "texto"));
  const [n, setN] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    const dur = Math.min(Math.max(durationMs * 0.6, 600), 1600);
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setN(valor * easeOutCubic(p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [valor, durationMs]);
  const display = Number.isInteger(valor) ? Math.round(n).toLocaleString("es") : (Math.round(n * 10) / 10).toLocaleString("es");
  return (
    <Shell className="items-center text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}
        className="text-7xl font-black bg-gradient-to-br from-fuchsia-300 to-violet-400 bg-clip-text text-transparent leading-none"
      >
        {display}{sufijo}
      </motion.div>
      <p className="text-2xl text-zinc-300 mt-4 max-w-sm">{etiqueta}</p>
    </Shell>
  );
}

function StepFlow({ props }: VocabProps) {
  const pasos = asStrArr(pick(props, "pasos", "steps", "items")).slice(0, 5);
  return (
    <Shell>
      <Kicker>Proceso</Kicker>
      <motion.ol variants={stagger} initial="hidden" animate="show" className="space-y-3">
        {pasos.map((p, i) => (
          <motion.li key={i} variants={itemUp} className="flex items-center gap-3">
            <span className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white font-black flex items-center justify-center">{i + 1}</span>
            <span className="text-xl text-zinc-100 leading-snug">{p}</span>
          </motion.li>
        ))}
      </motion.ol>
    </Shell>
  );
}

function QuoteBeat({ props }: VocabProps) {
  const cita = asStr(pick(props, "cita", "quote", "texto"));
  const autor = asStr(pick(props, "autor", "author", "fuente"));
  return (
    <Shell>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <span className="text-fuchsia-500/60 text-7xl font-serif leading-none block mb-2">&ldquo;</span>
        <p className="text-3xl font-bold text-white leading-snug">{cita}</p>
        {autor && <p className="text-lg text-zinc-400 mt-5">— {autor}</p>}
      </motion.div>
    </Shell>
  );
}

function KeyImage({ props }: VocabProps) {
  const icono = asStr(pick(props, "icono", "icon", "emoji"));
  const rotulo = asStr(pick(props, "rotulo", "label", "titulo"));
  const subtexto = asStr(pick(props, "subtexto", "subtitle", "detalle"));
  const glyph = icono && icono.length <= 3 ? icono : "✦";
  return (
    <Shell className="items-center text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.7, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 0.5 }}
        className="text-7xl mb-5"
      >
        {glyph}
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.2 }}
        className="text-4xl font-black text-white leading-tight"
      >
        {rotulo}
      </motion.p>
      {subtexto && <p className="text-xl text-zinc-400 mt-3 max-w-sm">{subtexto}</p>}
    </Shell>
  );
}

function ProgressBar({ props, durationMs }: VocabProps) {
  const etiqueta = asStr(pick(props, "etiqueta", "label", "titulo"));
  const pct = Math.max(0, Math.min(100, asNum(pick(props, "pct", "porcentaje", "valor"))));
  return (
    <Shell>
      <Kicker>Proporción</Kicker>
      <p className="text-2xl font-bold text-white mb-5 leading-snug">{etiqueta}</p>
      <div className="h-5 rounded-full bg-zinc-800 overflow-hidden">
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: Math.min(Math.max(durationMs * 0.5, 600), 1400) / 1000, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-fuchsia-500 to-violet-500"
        />
      </div>
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
        className="text-5xl font-black text-fuchsia-300 mt-4"
      >
        {Math.round(pct)}%
      </motion.p>
    </Shell>
  );
}

/** Registro: el Director solo puede elegir de estas claves. */
export const SCROLL_COMPONENTS: Record<ComponenteScroll, React.FC<VocabProps>> = {
  TermCallout,
  BuildList,
  VersusSplit,
  Timeline,
  NodeGraph,
  Counter,
  StepFlow,
  QuoteBeat,
  KeyImage,
  ProgressBar,
};
