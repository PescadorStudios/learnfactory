"use client";

import { useState } from "react";
import { Star } from "lucide-react";

/** Fila de estrellas 0-5. Si `onRate` se provee, es interactiva (enteros 1-5). */
export default function StarRating({
  value,
  onRate,
  size = "w-4 h-4",
}: {
  value: number | null;
  onRate?: (stars: number) => void;
  size?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const interactive = Boolean(onRate);
  const shown = hover ?? value ?? 0;

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => {
        const filled = interactive ? shown >= i : (value ?? 0) >= i;
        const half = !interactive && (value ?? 0) >= i - 0.5 && (value ?? 0) < i;
        return (
          <button
            key={i}
            type="button"
            disabled={!interactive}
            onMouseEnter={() => interactive && setHover(i)}
            onMouseLeave={() => interactive && setHover(null)}
            onClick={() => onRate?.(i)}
            className={interactive ? "cursor-pointer transition-transform hover:scale-110" : "cursor-default"}
          >
            <Star
              className={`${size} ${
                filled ? "text-amber-400 fill-current" : half ? "text-amber-400/60 fill-current" : "text-zinc-700"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
