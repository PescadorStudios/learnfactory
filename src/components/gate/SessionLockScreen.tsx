"use client";

// Pantalla de bloqueo de sesión: el momento de conversión del producto.
//
// Decisiones de diseño:
// - Cubre la pantalla completa y NO se puede cerrar (no hay X): el bloqueo no es
//   negociable. Shell tomada de ScrollFeed.tsx:285 pero a z-50, porque su gate de
//   arranque ya ocupa z-40; fondo opaco como AudioLessonStation.tsx:52 para que no
//   se pueda hacer scroll por detrás.
// - La tarjeta interior es la del paywall existente (sources/page.tsx:709-718) para
//   que se sienta parte de la app, no un cartel pegado.
// - Ámbar = "premium/bloqueado" en este proyecto; violeta = acción.
// - Siempre hay una salida ("Explorar la biblioteca"): encerrar al usuario del todo
//   mata el deseo, y la biblioteca es justo donde ve lo que se está perdiendo.

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Crown, Hourglass, CirclePlay, FolderOpen, FileText, ArrowRight } from "lucide-react";
import { MEMBERSHIP_MONTHLY_LABEL } from "@/lib/pricing";
import type { GateState } from "@/lib/types";
import LockCountdown from "./LockCountdown";

export default function SessionLockScreen({
  gate,
  onElapsed,
  nextUp,
}: {
  gate: GateState;
  /** Se cumplió el tiempo: la página debe volver a consultar el muro. */
  onElapsed?: () => void;
  /** Cliffhanger: qué le espera al volver. */
  nextUp?: string | null;
}) {
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex items-center justify-center p-4 overflow-y-auto">
      {/* Halo ámbar, mismo lenguaje que /premium/gracias */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[60%] h-[40%] rounded-full bg-amber-500/10 blur-[140px] pointer-events-none" />

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md my-auto"
      >
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-center justify-center mb-4">
            <Hourglass className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-white">Fin de esta sesión de estudio</h2>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Estudiar con nosotros es gratis, pero <span className="text-white font-semibold">por sesiones</span>.
            Ya completaste {gate.budget} {gate.budget === 1 ? "unidad" : "unidades"} seguidas — descansa un rato y vuelve.
          </p>
        </div>

        {/* El reloj */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-5 py-4 mb-5 text-center">
          <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 mb-1">
            Puedes volver en
          </p>
          <LockCountdown
            until={gate.lockedUntil}
            onElapsed={onElapsed}
            className="text-3xl font-bold text-white"
          />
        </div>

        {/* Cliffhanger: qué se está perdiendo ahora mismo */}
        {nextUp && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-800/30 px-4 py-3 mb-5">
            <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 mb-1">
              Cuando vuelvas te espera
            </p>
            <p className="text-sm text-zinc-200 font-medium line-clamp-2">«{nextUp}»</p>
          </div>
        )}

        {/* La oferta */}
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-bold text-white">O sigue ahora mismo, sin esperas</span>
          </div>
          <p className="text-sm text-zinc-400 mb-3">
            Hazte miembro por <span className="text-amber-400 font-bold">{MEMBERSHIP_MONTHLY_LABEL}</span> y
            estudia sin límites, sin relojes.
          </p>

          {/* La segunda mitad de la oferta: crear rutas propias */}
          <p className="text-xs text-zinc-400 mb-2">
            Y además creas <span className="text-white font-semibold">tus propias rutas</span> pegando:
          </p>
          <ul className="space-y-1.5 text-xs text-zinc-300">
            <li className="flex items-center gap-2">
              <CirclePlay className="w-3.5 h-3.5 text-rose-400 shrink-0" /> Links de videos de YouTube
            </li>
            <li className="flex items-center gap-2">
              <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" /> Libros de Google Drive
            </li>
            <li className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-secondary shrink-0" /> O cualquier PDF
            </li>
          </ul>
        </div>

        <button
          onClick={() => router.push("/premium")}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
        >
          Hazme miembro <ArrowRight className="w-5 h-5" />
        </button>
        <button
          onClick={() => router.push("/")}
          className="w-full mt-3 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          Mirar la biblioteca
        </button>
        <p className="text-center text-[11px] text-zinc-600 mt-4">
          Explorar la biblioteca siempre es gratis.
        </p>
      </motion.div>
    </div>
  );
}
