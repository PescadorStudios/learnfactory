"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Film } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { getRouteScrollFeed, getGlobalScrollFeed, type ScrollCorto, type ScrollFeedFilters } from "@/app/scrollActions";
import ScrollFeed from "@/components/scroll/ScrollFeed";
import ScrollLobby from "@/components/scroll/ScrollLobby";

function Loader() {
  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center">
      <Loader2 className="w-10 h-10 text-fuchsia-500 animate-spin" />
    </div>
  );
}

function EmptyState({ routeId, onHome }: { routeId: boolean; onHome: () => void }) {
  return (
    <div className="min-h-[100dvh] bg-black text-white flex flex-col items-center justify-center text-center px-8">
      <Film className="w-12 h-12 text-fuchsia-500/70 mb-4" />
      <h1 className="text-2xl font-bold mb-2">No hay cortos para esta selección</h1>
      <p className="text-zinc-500 mb-6">
        {routeId ? "Esta ruta todavía no generó sus videos." : "Prueba con otros temas o rutas."}
      </p>
      <button onClick={onHome} className="px-6 py-3 rounded-2xl bg-fuchsia-600 text-white font-bold">Volver al inicio</button>
    </div>
  );
}

function ScrollInner() {
  const router = useRouter();
  const { token, loading } = useAuth();
  const params = useSearchParams();
  const routeId = params.get("route"); // deep link a mini-feed de una ruta (salta el lobby)

  const [filters, setFilters] = useState<ScrollFeedFilters | null>(null);
  const [cortos, setCortos] = useState<ScrollCorto[] | null>(null);

  // Deep link de ruta: cargar directo, sin lobby.
  useEffect(() => {
    if (loading || !routeId) return;
    let active = true;
    getRouteScrollFeed(token, routeId).then(r => { if (active) setCortos(r?.cortos ?? []); });
    return () => { active = false; };
  }, [token, loading, routeId]);

  // Feed global según la configuración elegida en el lobby.
  useEffect(() => {
    if (loading || routeId || !filters) return;
    let active = true;
    getGlobalScrollFeed(token, filters).then(c => { if (active) setCortos(c); });
    return () => { active = false; };
  }, [token, loading, routeId, filters]);

  if (loading) return <Loader />;

  // Sin deep link y sin configuración aún → lobby.
  if (!routeId && !filters) {
    return <ScrollLobby token={token} onStart={setFilters} />;
  }

  if (cortos === null) return <Loader />;
  if (cortos.length === 0) {
    // Desde el lobby, permite reconfigurar; desde deep link, volver al inicio.
    return <EmptyState routeId={Boolean(routeId)} onHome={() => (routeId ? router.push("/") : setFilters(null))} />;
  }

  return <ScrollFeed cortos={cortos} token={token} />;
}

export default function ScrollPage() {
  return (
    <Suspense fallback={<Loader />}>
      <ScrollInner />
    </Suspense>
  );
}
