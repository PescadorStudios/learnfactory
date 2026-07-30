"use client";

// Muro de registro para visitantes SIN cuenta (/scroll y /tunel funcionan sin
// sesión). Aquí NUNCA se pide dinero: el objetivo es la cuenta gratuita. Por eso
// es violeta (acción) y no ámbar (premium), y no lleva precio ni reloj.

import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";
import { ANON_FREE_UNITS } from "@/lib/sessionBudget";

export default function AnonSignupWall() {
  const router = useRouter();
  const pathname = usePathname();

  // Al volver de crear la cuenta, el usuario aterriza donde estaba.
  const next = encodeURIComponent(pathname || "/");

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex items-center justify-center p-4 overflow-y-auto">
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[60%] h-[40%] rounded-full bg-primary/15 blur-[140px] pointer-events-none" />

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md my-auto text-center"
      >
        <div className="w-16 h-16 mx-auto bg-primary/10 border border-primary/40 rounded-2xl flex items-center justify-center mb-4">
          <Sparkles className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-white">Crea tu cuenta gratis para seguir</h2>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          Ya probaste {ANON_FREE_UNITS}. Con una cuenta guardas tu progreso, ganas XP,
          subes de nivel y desbloqueas los 4 modos de estudio.
          <span className="block mt-2 text-zinc-300 font-medium">Es gratis. Sin tarjeta.</span>
        </p>

        <button
          onClick={() => router.push(`/login?mode=signup&next=${next}`)}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
        >
          Crear mi cuenta <ArrowRight className="w-5 h-5" />
        </button>
        <button
          onClick={() => router.push(`/login?next=${next}`)}
          className="w-full mt-3 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          Ya tengo cuenta
        </button>
      </motion.div>
    </div>
  );
}
