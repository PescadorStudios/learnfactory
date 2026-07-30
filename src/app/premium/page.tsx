"use client";

// Página de la membresía. Antes no existía NINGUNA página de precios: el único
// checkout estaba enterrado en un modal dentro de /sources, así que el muro de
// sesiones no tenía a dónde enviar al usuario. Esta es esa página.
//
// Usa useAuth y no useRequireAuth a propósito: un visitante sin cuenta debe poder
// ver el precio antes de registrarse.

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Crown,
  Check,
  Infinity as InfinityIcon,
  CirclePlay,
  FolderOpen,
  FileText,
  ArrowRight,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { getPlan } from "@/app/socialActions";
import AppHeader from "@/components/AppHeader";
import { Logo } from "@/components/Logo";
import PremiumCheckout from "@/components/PremiumCheckout";
import { MEMBERSHIP, MEMBERSHIP_MONTHLY_LABEL } from "@/lib/pricing";
import { SESSION_BUDGET_DEFAULT, LOCK_HOURS } from "@/lib/sessionBudget";
import type { PlanState } from "@/lib/types";
import { useEffect, useState } from "react";

const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6 },
} as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
}

const INCLUDED = [
  {
    icon: InfinityIcon,
    title: "Estudio sin límites",
    body: `Sin la pausa de ${LOCK_HOURS} horas cada ${SESSION_BUDGET_DEFAULT} unidades. Lecciones, podcast, Modo Scroll y Túnel, todo seguido.`,
  },
  {
    icon: CirclePlay,
    title: "Rutas desde YouTube",
    body: "Pega los links de los videos que quieras y la IA los convierte en una ruta que enseña de verdad.",
  },
  {
    icon: FolderOpen,
    title: "Rutas desde tus libros",
    body: "Comparte un libro de Google Drive o cualquier PDF y se vuelve una ruta con lecciones, audio y retos.",
  },
  {
    icon: FileText,
    title: "3 créditos cada mes",
    body: "Cada pago suma 3 créditos de creación: una ruta completa, o tres cortas. Los créditos no se vencen.",
  },
];

function PremiumContent() {
  const router = useRouter();
  const { token, email, session, loading } = useAuth();
  const [plan, setPlan] = useState<PlanState | null>(null);

  useEffect(() => {
    if (!token) return;
    getPlan(token).then(setPlan);
  }, [token]);

  const active = Boolean(plan?.membershipActive);

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {session ? (
        <AppHeader />
      ) : (
        // Sin sesión no hay AppHeader (mismo criterio que la landing).
        <header className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-900">
          <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
            <button onClick={() => router.push("/")} aria-label="Inicio">
              <Logo />
            </button>
            <button
              onClick={() => router.push("/login?next=/premium")}
              className="text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              Entrar
            </button>
          </div>
        </header>
      )}

      <div className="max-w-5xl mx-auto px-6 py-14 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-[35%] rounded-full bg-amber-500/10 blur-[140px] pointer-events-none" />

        {/* ── Encabezado ── */}
        <motion.div {...fadeUp} className="relative text-center max-w-2xl mx-auto mb-12">
          <div className="w-16 h-16 mx-auto bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-center justify-center mb-5">
            <Crown className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Estudia sin relojes.
            <span className="block text-zinc-500">Y crea tus propias rutas.</span>
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            Estudiar en Learn Factory es gratis, por sesiones de {SESSION_BUDGET_DEFAULT} unidades.
            La membresía quita ese límite y te deja construir rutas con tu propio material.
          </p>
        </motion.div>

        {/* ── Estado / Checkout ── */}
        <motion.div {...fadeUp} className="relative max-w-md mx-auto mb-16">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
            {loading ? (
              <div className="flex items-center justify-center gap-2 text-zinc-400 py-8">
                <Loader2 className="w-5 h-5 animate-spin" /> Cargando…
              </div>
            ) : active ? (
              // Ya es miembro: no se le vuelve a vender, se le informa.
              <div className="text-center">
                <div className="w-14 h-14 mx-auto bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-center justify-center mb-4">
                  <Check className="w-7 h-7 text-amber-400" />
                </div>
                <h2 className="text-xl font-bold mb-2">
                  {plan?.founder ? "Eres fundador" : "Ya eres miembro"}
                </h2>
                <p className="text-zinc-400 text-sm mb-6">
                  {plan?.founder
                    ? "Tu acceso ilimitado no vence nunca. Gracias por haber estado desde el principio."
                    : plan?.premiumUntil
                      ? `Tu membresía va hasta el ${formatDate(plan.premiumUntil)}. Te avisamos por correo antes de que venza.`
                      : "Tu membresía está activa."}
                </p>
                <button
                  onClick={() => router.push("/")}
                  className="w-full px-6 py-3.5 rounded-2xl font-bold bg-primary text-white hover:bg-primary-hover transition-all"
                >
                  Seguir estudiando
                </button>
                {!plan?.founder && (
                  <details className="mt-5 text-left">
                    <summary className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer text-center">
                      Renovar por adelantado
                    </summary>
                    <p className="text-[11px] text-zinc-600 mt-3 mb-3 text-center">
                      Cada pago suma 30 días sobre lo que ya tienes: renovar temprano no pierde días.
                    </p>
                    {token && <PremiumCheckout token={token} email={email} />}
                  </details>
                )}
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="flex items-baseline justify-center gap-2">
                    <span className="text-4xl font-bold text-white">{MEMBERSHIP.CO.display}</span>
                    <span className="text-zinc-500 font-medium">/ mes</span>
                  </div>
                  <p className="text-zinc-500 text-sm mt-1">
                    o {MEMBERSHIP.INTL.display} al mes fuera de Colombia
                  </p>
                  <p className="text-zinc-500 text-xs mt-3">
                    Sin cobro automático: renuevas tú cuando quieras. Cancelar es simplemente no renovar.
                  </p>
                </div>

                {token ? (
                  <PremiumCheckout token={token} email={email} />
                ) : (
                  <>
                    <button
                      onClick={() => router.push("/login?mode=signup&next=/premium")}
                      className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-lg bg-primary text-white hover:bg-primary-hover transition-all"
                    >
                      Crear cuenta y empezar <ArrowRight className="w-5 h-5" />
                    </button>
                    <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-500 pt-3">
                      <ShieldCheck className="w-3.5 h-3.5" /> Pago protegido por Bold
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* ── Qué incluye ── */}
        <motion.div {...fadeUp} className="relative grid md:grid-cols-2 gap-4 mb-16">
          {INCLUDED.map(f => (
            <div key={f.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <f.icon className="w-6 h-6 text-amber-400 mb-3" />
              <h3 className="font-bold text-white mb-1.5">{f.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </motion.div>

        {/* ── Lo que sigue siendo gratis (honestidad = confianza) ── */}
        <motion.div
          {...fadeUp}
          className="relative rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 text-center max-w-2xl mx-auto"
        >
          <h2 className="text-xl font-bold mb-3">Y esto sigue siendo gratis, siempre</h2>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Explorar la biblioteca completa, tu perfil, tu XP, tus rachas y tu reputación.
            Y estudiar: {SESSION_BUDGET_DEFAULT} unidades cada sesión, todas las sesiones que quieras.
            La membresía solo quita la espera y te da el estudio de creación.
          </p>
          <p className="text-zinc-600 text-xs mt-4">
            {MEMBERSHIP_MONTHLY_LABEL} · pago mensual manual · sin permanencia
          </p>
        </motion.div>
      </div>
    </main>
  );
}

export default function PremiumPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <PremiumContent />
    </Suspense>
  );
}
