"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "./supabase/client";

/**
 * Suscripción websocket (Supabase Realtime) a los cambios de una ruta:
 * cada vez que una lección del lote se actualiza (pending → generating →
 * ready/error) o la ruta cambia de estado, dispara `onChange` para que la UI
 * coloque el resultado en su placeholder. Coalesce ráfagas de eventos.
 */
export function useRouteRealtime(routeId: string | null | undefined, onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!routeId) return;
    const sb = supabaseBrowser();

    // Coalescer: varias lecciones pueden completarse casi a la vez
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        onChangeRef.current();
      }, 400);
    };

    const channel = sb
      .channel(`route-${routeId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "lessons", filter: `route_id=eq.${routeId}` },
        fire
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "routes", filter: `id=eq.${routeId}` },
        fire
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      sb.removeChannel(channel);
    };
  }, [routeId]);
}
