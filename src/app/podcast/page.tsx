"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { useSessionGate } from "@/lib/useSessionGate";
import SessionLockScreen from "@/components/gate/SessionLockScreen";
import SessionMeter from "@/components/gate/SessionMeter";
import { getPodcastCatalog, type PodcastRouteGroup } from "@/app/routeActions";
import AppHeader from "@/components/AppHeader";
import PodcastLobby from "./PodcastLobby";
import PodcastPlayer from "./PodcastPlayer";
import type { PodcastTrack } from "./types";

export default function PodcastPage() {
  const { token, loading, session } = useRequireAuth();
  const gate = useSessionGate(token);
  const [catalog, setCatalog] = useState<PodcastRouteGroup[] | null>(null);
  const [queue, setQueue] = useState<PodcastTrack[] | null>(null);

  useEffect(() => {
    if (token) getPodcastCatalog(token).then(setCatalog);
  }, [token]);

  const play = useCallback((tracks: PodcastTrack[]) => {
    if (tracks.length) setQueue(tracks);
  }, []);

  if (loading || !session) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </main>
    );
  }

  // Muro de sesiones ANTES de armar la cola: así el reproductor nunca arranca ya
  // bloqueado (su comprobación interna es solo para el bloqueo a media cola).
  if (gate.state?.walled) {
    return <SessionLockScreen gate={gate.state} onElapsed={gate.refresh} />;
  }

  // Reproductor a pantalla completa cuando hay una cola.
  if (queue) {
    return <PodcastPlayer queue={queue} token={token ?? ""} onExit={() => setQueue(null)} />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AppHeader />
      {gate.state && !gate.state.unlimited && (
        <div className="max-w-5xl mx-auto px-6 pt-4 flex justify-end">
          <SessionMeter gate={gate.state} />
        </div>
      )}
      {catalog === null ? (
        <div className="flex items-center justify-center gap-2 text-zinc-500 py-32">
          <Loader2 className="w-5 h-5 animate-spin" /> Cargando lecciones...
        </div>
      ) : (
        <PodcastLobby catalog={catalog} onPlay={play} />
      )}
    </main>
  );
}
