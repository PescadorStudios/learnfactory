"use client";

// El chunk con el pivote ANCLADO. Es el único CSS delicado del modo, por eso
// vive aislado.
//
// La idea: una rejilla de tres columnas donde las dos laterales son `1fr`. El
// sobrante se reparte a partes iguales entre izquierda y derecha, así que la
// celda `auto` del pivote queda en el centro exacto del contenedor SEA CUAL SEA
// la longitud de la palabra. `text-right` y `text-left` pegan los fragmentos
// contra ella.
//
// Por qué no otras opciones:
//   · Fuente monoespaciada + contar caracteres → se lee bastante peor, y sigue
//     fallando con acentos y ligaduras.
//   · `position:absolute` + medir el ancho → un reflow por palabra, a 10 Hz.
// Con la rejilla el pivote está centrado en SU celda, así que su centro óptico
// coincide con el 50 % del contenedor tanto para una "i" como para una "m".
// (Verificable: `r.left + r.width/2` de [data-orp] es constante ±1 px.)

import type { ReadingPrefs } from "@/lib/types";

const HIGHLIGHT: Record<ReadingPrefs["highlightStyle"], string> = {
  // red-400 y no red-500: sobre el fondo verde-negro del modo, red-500 se queda
  // en ~4.4:1. Esto es texto pequeño en movimiento, necesita el margen.
  rojo: "text-red-400",
  // Alternativas para daltonismo rojo-verde: sobre este fondo, el rojo es
  // exactamente el eje que un protanope no distingue.
  subrayado: "underline decoration-4 underline-offset-4 decoration-emerald-300",
  negrita: "font-black text-white",
};

export default function OrpWord({
  text,
  orp,
  fontSize,
  highlightStyle = "rojo",
}: {
  text: string;
  orp: number;
  fontSize: number;
  highlightStyle?: ReadingPrefs["highlightStyle"];
}) {
  // Por code points: un slice por unidades UTF-16 partiría un carácter compuesto.
  const cps = [...text];
  const i = Math.max(0, Math.min(cps.length - 1, orp));
  const before = cps.slice(0, i).join("");
  const pivot = cps[i] ?? "";
  const after = cps.slice(i + 1).join("");

  return (
    <div className="relative w-full max-w-4xl mx-auto select-none overflow-hidden">
      {/* Guías del punto de anclaje. Al estar a left-1/2 del MISMO contenedor,
          coinciden con la columna del pivote por construcción. */}
      <div className="absolute left-1/2 -translate-x-1/2 top-0 h-4 w-0.5 bg-emerald-400/40" />
      <div className="absolute left-1/2 -translate-x-1/2 bottom-0 h-4 w-0.5 bg-emerald-400/40" />

      <div
        className="grid grid-cols-[1fr_auto_1fr] items-baseline py-8 leading-none tracking-tight"
        style={{ fontSize: `${fontSize}px` }}
        // El chorro de palabras NO se anuncia: un aria-live que cambia 10 veces
        // por segundo hace inutilizable cualquier lector de pantalla. La región
        // anunciada es la de secciones, en VelozReader.
        aria-hidden
      >
        <span className="text-right whitespace-pre text-zinc-100">{before}</span>
        <span data-orp className={HIGHLIGHT[highlightStyle]}>
          {pivot}
        </span>
        <span className="text-left whitespace-pre text-zinc-100">{after}</span>
      </div>
    </div>
  );
}
