"use client";

// ──────────────────────────────────────────────────
//  Landing pública (cara del dominio, visitantes sin sesión).
//  Funnel: anónimo → explora portadas reales → lobby /route/[id] → registro.
//  Mantiene la identidad gráfica (Outfit, violeta/azul/rosa, paleta del Túnel,
//  glow que respira, framer-motion) y la eleva a una pieza de alta conversión.
// ──────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight, ChevronRight, Sparkles, Headphones, Brain, Network,
  Trophy, Plus, Video, Loader2, Target, MessageSquare, InfinityIcon,
  Star, Zap, GraduationCap,
} from "lucide-react";
import { getLandingLibrary } from "@/app/socialActions";
import type { LibrarySection } from "@/lib/types";
import { Logo, LogoMark } from "@/components/Logo";
import RouteRow from "@/components/RouteRow";

const SIGNUP = "/login?mode=signup";
const LOGIN = "/login";

/** Animación de entrada estándar de la marca. */
const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

export default function LandingPage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [sections, setSections] = useState<LibrarySection[] | null>(null);
  const showcaseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getLandingLibrary().then(setSections).catch(() => setSections([]));
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goSignup = () => router.push(SIGNUP);
  const scrollToShowcase = () =>
    showcaseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50 overflow-x-hidden">
      {/* ── Header propio (no AppHeader: aquí no hay sesión) ── */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
          scrolled ? "bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/70" : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Logo className="h-7 md:h-8" glow={scrolled} />
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => router.push(LOGIN)}
              className="text-sm font-semibold text-zinc-300 hover:text-white transition-colors px-3 py-2"
            >
              Iniciar sesión
            </button>
            <button
              onClick={goSignup}
              className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white rounded-full px-4 md:px-5 py-2.5 text-sm font-bold transition-all shadow-[0_0_24px_rgba(139,92,246,0.35)] hover:shadow-[0_0_38px_rgba(139,92,246,0.5)]"
            >
              Empezar gratis
            </button>
          </div>
        </div>
      </header>

      {/* ════════════════════ 1 · HERO ════════════════════ */}
      <section className="relative pt-28 md:pt-36 pb-20 md:pb-28">
        {/* Capa: gradientes radiales profundos */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(139,92,246,0.20),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(59,130,246,0.14),transparent_55%)] pointer-events-none" />
        {/* Capa: glow que respira */}
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 right-1/4 w-[34rem] h-[34rem] rounded-full bg-primary/20 blur-[140px] pointer-events-none"
        />
        {/* Capa: símbolo monumental desvanecido */}
        <LogoMark className="hidden md:block absolute -right-24 top-10 w-[30rem] h-[30rem] opacity-[0.05] rotate-12 pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="max-w-3xl"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-5">
              <InfinityIcon className="w-4 h-4" /> El fin del scroll sin sentido
            </span>

            <motion.h1
              initial={{ opacity: 0, y: 20, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.1, duration: 0.8, ease: "easeOut" }}
              className="text-4xl md:text-[4rem] md:leading-[1.05] font-bold tracking-tight mb-6"
            >
              Tu cerebro merece algo mejor que el{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary">
                scroll infinito.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="text-zinc-400 text-lg md:text-xl mb-9 max-w-2xl leading-relaxed"
            >
              Convierte el tiempo de pantalla en conocimiento real. Rutas de estudio
              que te retan, te narran y te conectan ideas — <span className="text-zinc-200 font-semibold">siempre gratis</span>. O crea
              la tuya, sobre lo que sea, con IA.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="flex flex-wrap items-center gap-3"
            >
              <button
                onClick={goSignup}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-8 py-4 text-base font-bold transition-all shadow-[0_0_34px_rgba(139,92,246,0.4)] hover:shadow-[0_0_52px_rgba(139,92,246,0.55)]"
              >
                Empezar gratis <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={scrollToShowcase}
                className="inline-flex items-center gap-2 bg-white/5 border border-zinc-700 hover:border-zinc-500 text-white rounded-full px-7 py-4 text-base font-bold transition-all backdrop-blur-sm"
              >
                Ver rutas
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.8 }}
              className="mt-10 pt-6 border-t border-zinc-800/60 flex flex-wrap items-center gap-x-7 gap-y-2.5 text-xs text-zinc-500"
            >
              <span className="inline-flex items-center gap-2"><LogoMark className="w-4 h-4" /> Podcast narrado por IA</span>
              <span className="inline-flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-primary/70" /> Juegos de atención</span>
              <span className="inline-flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-secondary/70" /> Debates socráticos</span>
              <span className="inline-flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-accent/70" /> Biblioteca colectiva</span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 2 · MANIFIESTO / EL PROBLEMA ════════════════ */}
      <section className="relative py-20 md:py-28 border-y border-zinc-800/60">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <motion.span {...fadeUp} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-accent/90 mb-5">
            <Brain className="w-4 h-4" /> El problema
          </motion.span>
          <motion.h2 {...fadeUp} className="text-3xl md:text-5xl font-bold tracking-tight mb-7 leading-tight">
            Las apps no fueron diseñadas para que crezcas.
            <br />
            <span className="text-zinc-500">Fueron diseñadas para retenerte.</span>
          </motion.h2>
          <motion.p {...fadeUp} className="text-zinc-400 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto">
            Cada deslizamiento entrena a tu cerebro para querer el siguiente. Horas que
            desaparecen sin dejar nada. Aquí el scroll tiene un destino: cada minuto que
            inviertes se convierte en un concepto que de verdad te llevas contigo.
          </motion.p>
        </div>
      </section>

      {/* ════════════════ 3 · LOS 3 MODOS DE ESTUDIO ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-14 max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-4">
              <Sparkles className="w-4 h-4" /> Tres formas de aprender
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Estudia como tu mente lo necesite hoy.
            </h2>
            <p className="text-zinc-400 text-lg">
              Activo cuando quieres retarte. Pasivo cuando solo quieres absorber.
            </p>
          </motion.div>

          {/* Rutas activas — bloque ancho */}
          <motion.div
            {...fadeUp}
            className="relative rounded-[2rem] overflow-hidden border border-primary/25 bg-[#0a0712] mb-6"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_40%,rgba(139,92,246,0.20),transparent_55%),radial-gradient(circle_at_90%_50%,rgba(244,63,94,0.14),transparent_50%)] pointer-events-none" />
            <div className="relative z-10 px-8 md:px-14 py-12 max-w-2xl">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-3">
                <Target className="w-3.5 h-3.5" /> Estudio activo
              </span>
              <h3 className="text-2xl md:text-4xl font-bold tracking-tight mb-4">Rutas que te retan a responder</h3>
              <p className="text-zinc-400 text-base md:text-lg leading-relaxed">
                No mires pasivo: pon atención y demuéstralo. Juegos de atención mientras
                escuchas, quizzes, debates socráticos y exámenes de jefe. Aprendes porque
                participas, no porque pasas la página.
              </p>
            </div>
          </motion.div>

          {/* Túnel + Podcast — dos columnas */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Modo Túnel */}
            <motion.div
              {...fadeUp}
              className="group relative rounded-[2rem] overflow-hidden border border-violet-500/25 bg-[#06070d] min-h-[22rem] flex flex-col"
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(56,189,248,0.16),transparent_55%),radial-gradient(circle_at_50%_90%,rgba(139,92,246,0.28),transparent_55%)] pointer-events-none" />
              {/* Anillos concéntricos (boca del túnel) */}
              <div className="absolute right-0 top-0 bottom-0 w-2/3 hidden sm:grid place-items-center pointer-events-none" aria-hidden>
                <div className="absolute w-64 h-64 rounded-full border border-cyan-400/10 transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute w-48 h-48 rounded-full border border-cyan-400/15 transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute w-32 h-32 rounded-full border border-violet-400/25 transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute w-9 h-9 rounded-full bg-gradient-to-br from-cyan-300/50 to-violet-500/50 blur-md" />
              </div>
              <div className="relative z-10 px-8 py-10 mt-auto max-w-sm">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300/90 mb-3">
                  <Network className="w-3.5 h-3.5" /> Red neuronal · Divergencia
                </span>
                <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-200 to-violet-300">Modo Túnel</span>
                </h3>
                <p className="text-zinc-400 text-base leading-relaxed">
                  Atraviesa un corredor 3D que cruza conceptos de distintas rutas. Aprendes
                  conectando ideas entre contextos — estudio activo, de menor exigencia.
                </p>
              </div>
            </motion.div>

            {/* Modo Podcast */}
            <motion.div
              {...fadeUp}
              className="group relative rounded-[2rem] overflow-hidden border border-primary/25 bg-[#0a0712] min-h-[22rem] flex flex-col"
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_30%,rgba(139,92,246,0.20),transparent_55%),radial-gradient(circle_at_85%_80%,rgba(59,130,246,0.16),transparent_55%)] pointer-events-none" />
              <div className="absolute right-6 top-10 hidden sm:flex items-center justify-center pointer-events-none" aria-hidden>
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-primary/25 to-secondary/20 border border-primary/30 flex items-center justify-center">
                  <Headphones className="w-12 h-12 text-primary/80" />
                </div>
              </div>
              <div className="relative z-10 px-8 py-10 mt-auto max-w-sm">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-3">
                  <Headphones className="w-3.5 h-3.5" /> Estudio pasivo
                </span>
                <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-secondary">Modo Podcast</span>
                </h3>
                <p className="text-zinc-400 text-base leading-relaxed">
                  Escucha los conceptos que quieras aprender, uno tras otro. Perfecto para
                  dormir, manejar o salir a caminar. Tu mente sigue sumando, sin pantalla.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ════════════════ 4 · DIVERGENCIA ════════════════ */}
      <section className="relative py-20 md:py-28 border-y border-zinc-800/60 bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.08),transparent_60%)]">
        <div className="max-w-5xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <motion.div {...fadeUp}>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300/90 mb-4">
              <Network className="w-4 h-4" /> Divergencia
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-5 leading-tight">
              Un concepto no vive solo.
            </h2>
            <p className="text-zinc-400 text-lg leading-relaxed">
              La verdadera comprensión llega cuando cruzas una idea con otras: la misma
              ley de física que explica un fenómeno también ilumina un negocio o una
              historia. LearnFactory conecta conceptos entre rutas para que aprendas
              desde varios ángulos a la vez.
            </p>
          </motion.div>
          <motion.div {...fadeUp} className="relative h-64 md:h-80">
            {/* Nodos/red abstracta */}
            <div className="absolute inset-0 grid place-items-center" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="absolute rounded-full border border-cyan-400/20"
                  style={{ width: `${8 + i * 6}rem`, height: `${8 + i * 6}rem` }}
                />
              ))}
              <div className="absolute w-3 h-3 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(56,189,248,0.8)]" style={{ top: "20%", left: "30%" }} />
              <div className="absolute w-3 h-3 rounded-full bg-violet-400 shadow-[0_0_20px_rgba(176,107,255,0.8)]" style={{ top: "65%", left: "60%" }} />
              <div className="absolute w-3 h-3 rounded-full bg-accent shadow-[0_0_20px_rgba(244,63,94,0.7)]" style={{ top: "40%", left: "75%" }} />
              <div className="absolute w-10 h-10 rounded-full bg-gradient-to-br from-cyan-300/60 to-violet-500/60 blur-sm" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 5 · GAMIFICACIÓN ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-12 max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-amber-400/90 mb-4">
              <Trophy className="w-4 h-4" /> Gamificación
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">Rétate. Supérate. Sube de nivel.</h2>
            <p className="text-zinc-400 text-lg">
              Cada lección suma. Niveles que se desbloquean, estrellas que ganas y rachas
              que mantener: el progreso se siente, y eso es lo que te trae de vuelta.
            </p>
          </motion.div>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { icon: Zap, color: "text-primary", title: "XP y estrellas", desc: "Ganas experiencia y estrellas por cada respuesta acertada y cada lección completada." },
              { icon: Trophy, color: "text-amber-400", title: "Niveles", desc: "De Oyente a Voz interior, de Viajero a Leyenda del túnel: tu constancia tiene rango." },
              { icon: GraduationCap, color: "text-secondary", title: "Reputación", desc: "Tu avance como explorador y tus graduados como creador construyen tu estatus." },
            ].map((c) => (
              <motion.div
                key={c.title}
                {...fadeUp}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 hover:border-zinc-700 transition-colors"
              >
                <c.icon className={`w-8 h-8 ${c.color} mb-4`} />
                <h3 className="text-lg font-bold mb-2">{c.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{c.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ 6 · CREA TUS RUTAS — GRATIS ════════════════ */}
      <section className="relative py-20 md:py-28 border-y border-zinc-800/60">
        <div className="max-w-5xl mx-auto px-4">
          <motion.div
            {...fadeUp}
            className="relative rounded-[2rem] overflow-hidden border border-primary/25 bg-zinc-950 px-8 md:px-14 py-14 text-center"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.22),transparent_60%)] pointer-events-none" />
            <div className="relative z-10 max-w-2xl mx-auto">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-5">
                <Plus className="w-4 h-4" /> Crea lo que quieras
              </span>
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-5">
                Aprende cualquier tema. <br className="hidden md:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary">Crea el tuyo con IA.</span>
              </h2>
              <p className="text-zinc-400 text-lg mb-3 leading-relaxed">
                Dale un tema y tus fuentes: la IA arma una ruta completa con narración,
                retos y exámenes. Lo que sea que necesites dominar, en minutos.
              </p>
              <p className="text-zinc-300 font-semibold mb-8 inline-flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-current" /> Estudiar siempre es gratis.
              </p>
              <div>
                <button
                  onClick={goSignup}
                  className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-8 py-4 text-base font-bold transition-all shadow-[0_0_34px_rgba(139,92,246,0.4)] hover:shadow-[0_0_52px_rgba(139,92,246,0.55)]"
                >
                  <Plus className="w-5 h-5" /> Crear mi primera ruta
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 7 · SHOWCASE REAL ════════════════ */}
      <section ref={showcaseRef} className="relative py-20 md:py-24 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div {...fadeUp} className="mb-10 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-secondary/90 mb-4">
              <Sparkles className="w-4 h-4" /> Biblioteca colectiva
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Explora lo que la comunidad ya está aprendiendo.
            </h2>
            <p className="text-zinc-400 text-lg">
              Entra a cualquier ruta y mira su recorrido. Todas son gratis para estudiar.
            </p>
          </motion.div>

          {sections === null ? (
            <div className="flex items-center gap-2 text-zinc-500 py-12">
              <Loader2 className="w-5 h-5 animate-spin" /> Cargando la biblioteca...
            </div>
          ) : sections.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              Aún no hay rutas públicas. ¡Sé el primero en crear una!
            </div>
          ) : (
            sections.map((s) => <RouteRow key={s.key} title={s.title} routes={s.routes} />)
          )}
        </div>
      </section>

      {/* ════════════════ 8 · LA ERA DE LAS PREGUNTAS CORRECTAS ════════════════ */}
      <section className="relative py-20 md:py-28 border-y border-zinc-800/60 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.10),transparent_60%)]">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <motion.span {...fadeUp} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-5">
            <MessageSquare className="w-4 h-4" /> La nueva ventaja
          </motion.span>
          <motion.h2 {...fadeUp} className="text-3xl md:text-5xl font-bold tracking-tight mb-7 leading-tight">
            En la era de la IA gana quien sabe <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary">qué preguntar.</span>
          </motion.h2>
          <motion.p {...fadeUp} className="text-zinc-400 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto">
            Sobresalen quienes dominan los conceptos clave, saben cruzarlos con otras
            ideas y formulan las preguntas correctas para poner a la IA a su favor.
            LearnFactory entrena exactamente eso: la base mental que te hace formidable.
          </motion.p>
        </div>
      </section>

      {/* ════════════════ 9 · CREADORES DE CONTENIDO ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <motion.div {...fadeUp} className="relative order-2 md:order-1 h-56 md:h-72 grid place-items-center">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(244,63,94,0.16),transparent_60%)] pointer-events-none" />
            <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-br from-accent/30 to-primary/20 border border-accent/30 grid place-items-center">
              <Video className="w-14 h-14 text-accent" />
            </div>
          </motion.div>
          <motion.div {...fadeUp} className="order-1 md:order-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-accent/90 mb-4">
              <Video className="w-4 h-4" /> Para creadores
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-5 leading-tight">
              Tu audiencia te ve. Haz que de verdad aprenda.
            </h2>
            <p className="text-zinc-400 text-lg leading-relaxed mb-7">
              Convierte tus videos de YouTube y tu contenido en rutas que enseñan en serio:
              retan, evalúan y dejan huella. Pasa de likes que se olvidan a conocimiento
              que tu comunidad se lleva para siempre.
            </p>
            <button
              onClick={goSignup}
              className="inline-flex items-center gap-2 bg-white/5 border border-accent/40 text-white rounded-full px-7 py-3.5 font-bold transition-all hover:bg-accent/10 hover:border-accent hover:shadow-[0_0_35px_rgba(244,63,94,0.3)]"
            >
              Crea tu ruta <ChevronRight className="w-5 h-5" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 10 · CTA FINAL ════════════════ */}
      <section className="relative py-24 md:py-32 border-t border-zinc-800/60">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.18),transparent_60%)] pointer-events-none" />
        <motion.div
          animate={{ opacity: [0.25, 0.5, 0.25] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30rem] h-[30rem] rounded-full bg-primary/20 blur-[140px] pointer-events-none"
        />
        <div className="relative z-10 max-w-3xl mx-auto px-4 text-center">
          <motion.div {...fadeUp}>
            <LogoMark className="w-14 h-14 mx-auto mb-7" glow />
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Empieza gratis hoy.
            </h2>
            <p className="text-zinc-400 text-lg md:text-xl mb-9 max-w-xl mx-auto">
              Deja el scroll que no te lleva a ningún lado. Tu próxima ruta te espera.
            </p>
            <button
              onClick={goSignup}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-10 py-4 text-lg font-bold transition-all shadow-[0_0_40px_rgba(139,92,246,0.45)] hover:shadow-[0_0_60px_rgba(139,92,246,0.6)]"
            >
              Empezar gratis <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ FOOTER ════════════════ */}
      <footer className="border-t border-zinc-800/60 py-10">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <Logo className="h-7" />
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-400">
            <button onClick={() => router.push(LOGIN)} className="hover:text-white transition-colors">Iniciar sesión</button>
            <button onClick={goSignup} className="hover:text-white transition-colors">Crear ruta</button>
            <button onClick={goSignup} className="hover:text-white transition-colors">El Túnel</button>
            <button onClick={goSignup} className="hover:text-white transition-colors">Podcast</button>
          </nav>
          <p className="text-xs text-zinc-600">© {new Date().getFullYear()} LearnFactory</p>
        </div>
      </footer>
    </main>
  );
}
