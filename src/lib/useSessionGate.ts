"use client";

// Hook del muro de sesiones. A propósito NO es un contexto/provider: para
// compartirse tendría que vivir en src/app/layout.tsx, que es un server
// component de 58 líneas; envolverlo empujaría TODA la app (incluida la landing
// pública) tras una frontera de cliente y dispararía una consulta del muro en
// cada vista, también en páginas donde no se puede consumir nada.
//
// Cada página de consumo lo monta por su cuenta, igual que ya hace con useAuth.

import { useCallback, useEffect, useRef, useState } from "react";
import { getStudyGate } from "@/app/gateActions";
import type { GateState } from "@/lib/types";

export interface SessionGate {
  state: GateState | null;
  loading: boolean;
  /** Relee el estado del servidor. */
  refresh: () => Promise<void>;
  /**
   * Aplica el `gate` que devuelven saveAttempt / registrarCortoEvento /
   * startPodcastEpisode: actualiza el medidor sin una consulta extra.
   */
  apply: (gate?: GateState | null) => void;
}

export function useSessionGate(token: string | null | undefined): SessionGate {
  const [state, setState] = useState<GateState | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) {
      setState(null);
      setLoading(false);
      return;
    }
    try {
      const g = await getStudyGate(token);
      if (alive.current) setState(g);
    } catch {
      /* fallo de red: no se bloquea a nadie */
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const apply = useCallback((gate?: GateState | null) => {
    if (gate) setState(gate);
  }, []);

  return { state, loading, refresh, apply };
}
