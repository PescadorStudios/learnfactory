"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Film } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { getRouteScrollFeed, getGlobalScrollFeed, type ScrollCorto } from "@/app/scrollActions";
import ScrollFeed from "@/components/scroll/ScrollFeed";

function Loader() {
  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center">
      <Loader2 className="w-10 h-10 text-fuchsia-500 animate-spin" />
    </div>
  );
}

function ScrollInner() {
  const router = useRouter();
  const { token, loading } = useAuth();
  const params = useSearchParams();
  const routeId = params.get("route");
  const cat = params.get("cat") || undefined;
  const [cortos, setCortos] = useState<ScrollCorto[] | null>(null);

  useEffect(() => {
    if (loading) return;
    let active = true;
    (async () => {
      const data = routeId
        ? (await getRouteScrollFeed(token, routeId))?.cortos ?? []
        : await getGlobalScrollFeed(token, { category: cat });
      if (active) setCortos(data);
    })();
    return () => { active = false; };
  }, [token, loading, routeId, cat]);

  if (loading || cortos === null) return <Loader />;

  if (cortos.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-black text-white flex flex-col items-center justify-center text-center px-8">
        <Film className="w-12 h-12 text-fuchsia-500/70 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Aún no hay cortos aquí</h1>
        <p className="text-zinc-500 mb-6">
          {routeId ? "Esta ruta todavía no generó sus videos." : "Todavía no hay rutas con videos en el feed."}
        </p>
        <button onClick={() => router.push("/")} className="px-6 py-3 rounded-2xl bg-fuchsia-600 text-white font-bold">
          Volver al inicio
        </button>
      </div>
    );
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
