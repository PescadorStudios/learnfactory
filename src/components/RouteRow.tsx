"use client";

import type { RouteCard as RouteCardData } from "@/lib/types";
import RouteCard from "./RouteCard";

/** Fila horizontal con scroll de tarjetas de ruta (estilo Netflix). */
export default function RouteRow({ title, routes }: { title: string; routes: RouteCardData[] }) {
  if (!routes.length) return null;
  return (
    <section className="mb-10">
      <h2 className="text-lg md:text-xl font-bold text-white mb-3 px-1">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1 snap-x scrollbar-thin">
        {routes.map(r => (
          <div key={r.id} className="snap-start">
            <RouteCard route={r} />
          </div>
        ))}
      </div>
    </section>
  );
}
