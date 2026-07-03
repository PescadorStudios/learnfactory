"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Trophy, Sparkles } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getRetoPublic } from "@/app/retoActions";

/**
 * Confirmación post-pago de la entrada a un reto. Bold redirige aquí; el
 * webhook inscribe al participante en segundo plano, así que se sondea la
 * inscripción hasta verla confirmada (patrón /premium/gracias).
 */
function GraciasContent({ retoId }: { retoId: string }) {
  const router = useRouter();
  const { token, loading: authLoading, session } = useRequireAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [titulo, setTitulo] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const check = async () => {
      const reto = await getRetoPublic(token, retoId);
      if (!active) return;
      if (reto) setTitulo(reto.titulo);
      if (reto?.miProgreso) {
        setConfirmed(true);
      } else {
        setTries(t => t + 1);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [token, retoId]);

  if (authLoading || !session) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center relative overflow-hidden">
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[60%] h-[40%] rounded-full bg-primary/15 blur-[140px] pointer-events-none" />

      {confirmed ? (
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative z-10 flex flex-col items-center"
        >
          <div className="w-24 h-24 bg-primary/10 border border-primary/40 rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-primary/20">
            <Trophy className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-4xl font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-primary" /> ¡Estás dentro!
          </h1>
          <p className="text-zinc-400 max-w-md mb-8">
            Tu inscripción {titulo ? <>al reto <span className="text-white font-semibold">“{titulo}”</span></> : "al reto"} está
            confirmada. La ruta ya es tuya para siempre — y los primeros en completarla con verificación ganan los premios.
          </p>
          <button
            onClick={() => router.push(`/reto/${retoId}`)}
            className="px-8 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
          >
            Empezar el reto
          </button>
          <button onClick={() => router.push("/")} className="mt-3 text-zinc-500 hover:text-white text-sm transition-colors">
            Volver al inicio
          </button>
        </motion.div>
      ) : (
        <div className="relative z-10 flex flex-col items-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mb-6" />
          <h1 className="text-2xl font-bold mb-2">Confirmando tu pago...</h1>
          <p className="text-zinc-400 max-w-md">
            Estamos verificando la transacción con Bold. Esto suele tardar unos segundos.
          </p>
          {tries > 6 && (
            <p className="text-zinc-500 text-sm mt-6 max-w-sm">
              Si ya pagaste y esto tarda, tu inscripción se activará en cuanto Bold confirme. Puedes volver al reto y recargar
              más tarde.
            </p>
          )}
          <button onClick={() => router.push(`/reto/${retoId}`)} className="mt-6 text-zinc-500 hover:text-white text-sm transition-colors">
            Volver al reto
          </button>
        </div>
      )}
    </main>
  );
}

export default function RetoGraciasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <GraciasContent retoId={id} />
    </Suspense>
  );
}
