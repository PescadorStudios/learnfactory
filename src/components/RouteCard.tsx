"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Star, Users, BookOpen, Lock, Hammer } from "lucide-react";
import type { RouteCard as RouteCardData } from "@/lib/types";
import { creatorRank } from "@/lib/reputation";

/** Color del @creador según su rango (estatus visible en toda la biblioteca). */
const CREATOR_TIER_TEXT: Record<string, string> = {
  zinc: "text-zinc-600",
  bronze: "text-amber-600",
  silver: "text-zinc-300",
  gold: "text-amber-400",
  legend: "text-violet-400",
};

/** Tarjeta de ruta estilo Netflix (portada 16:9 + overlay). */
export default function RouteCard({ route, compact = false }: { route: RouteCardData; compact?: boolean }) {
  const router = useRouter();

  return (
    <motion.button
      whileHover={{ scale: 1.04, y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => router.push(`/route/${route.id}`)}
      className={`group relative shrink-0 ${compact ? "w-44" : "w-60"} text-left`}
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 group-hover:border-primary/60 transition-colors">
        {route.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={route.coverUrl} alt={route.topic} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/20">
            <BookOpen className="w-8 h-8 text-zinc-600" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        {route.visibility === "private" && (
          <span className="absolute top-2 right-2 bg-black/60 backdrop-blur rounded-full p-1.5">
            <Lock className="w-3 h-3 text-zinc-300" />
          </span>
        )}
        <div className="absolute bottom-0 inset-x-0 p-3">
          <h3 className="font-bold text-white text-sm leading-tight line-clamp-2">{route.topic}</h3>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2 px-0.5 text-xs text-zinc-500">
        {route.ratingAvg !== null && (
          <span className="flex items-center gap-1 text-amber-400">
            <Star className="w-3 h-3 fill-current" /> {route.ratingAvg}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" /> {route.studentCount}
        </span>
        {route.creator.username && (() => {
          const rank = creatorRank(route.creator.graduates ?? 0);
          return (
            <span className={`truncate ml-auto flex items-center gap-1 ${CREATOR_TIER_TEXT[rank.tier]}`} title={`Creador ${rank.name}`}>
              {rank.level >= 2 && <Hammer className="w-3 h-3 shrink-0" />}
              @{route.creator.username}
            </span>
          );
        })()}
      </div>
    </motion.button>
  );
}
