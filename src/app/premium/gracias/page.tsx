"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Crown, Sparkles } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getPlan } from "@/app/socialActions";

function GraciasContent() {
  const router = useRouter();
  const { token, loading: authLoading, session } = useRequireAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const check = async () => {
      const plan = await getPlan(token);
      if (!active) return;
      if (plan?.plan === "premium") {
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
  }, [token]);

  if (authLoading || !session) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-6 text-center relative overflow-hidden">
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[60%] h-[40%] rounded-full bg-amber-500/15 blur-[140px] pointer-events-none" />

      {confirmed ? (
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative z-10 flex flex-col items-center"
        >
          <div className="w-24 h-24 bg-amber-500/10 border border-amber-500/40 rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-amber-500/20">
            <Crown className="w-12 h-12 text-amber-400" />
          </div>
          <h1 className="text-4xl font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-amber-400" /> ¡Ya eres Premium!
          </h1>
          <p className="text-zinc-400 max-w-md mb-8">
            Tu pago se confirmó. Ahora puedes crear hasta <span className="text-white font-semibold">3 rutas</span> de aprendizaje con IA.
          </p>
          <button
            onClick={() => router.push("/sources")}
            className="px-8 py-4 rounded-2xl font-bold text-lg bg-amber-500 text-amber-950 hover:bg-amber-400 transition-all"
          >
            Crear una ruta nueva
          </button>
          <button onClick={() => router.push("/")} className="mt-3 text-zinc-500 hover:text-white text-sm transition-colors">
            Volver al inicio
          </button>
        </motion.div>
      ) : (
        <div className="relative z-10 flex flex-col items-center">
          <Loader2 className="w-12 h-12 text-amber-400 animate-spin mb-6" />
          <h1 className="text-2xl font-bold mb-2">Confirmando tu pago...</h1>
          <p className="text-zinc-400 max-w-md">
            Estamos verificando la transacción con Bold. Esto suele tardar unos segundos.
          </p>
          {tries > 6 && (
            <p className="text-zinc-500 text-sm mt-6 max-w-sm">
              Si ya pagaste y esto tarda, tu plan se activará en cuanto Bold confirme. Puedes volver al inicio y recargar más tarde.
            </p>
          )}
          <button onClick={() => router.push("/")} className="mt-6 text-zinc-500 hover:text-white text-sm transition-colors">
            Volver al inicio
          </button>
        </div>
      )}
    </main>
  );
}

export default function PremiumGraciasPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <GraciasContent />
    </Suspense>
  );
}
