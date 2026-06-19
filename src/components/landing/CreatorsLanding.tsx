"use client";

// ──────────────────────────────────────────────────
//  Landing para CREADORES (/creadoresteologia) — Grand Slam Offer.
//  Reusa la identidad gráfica de LearnFactory (Outfit, violeta/azul/rosa,
//  paleta del Túnel, glow que respira, framer-motion) y la ELEVA: titulares
//  más grandes, más aire, una sección de oferta que se siente premium.
//
//  Arco narrativo (8 secciones, copy en landing_creador_fundador.md):
//  Hero → Problema → El sueño → La prueba → Por qué funciona → Cómo funciona
//  → La Grand Slam Offer → Cierre.
//
//  Reglas de mensaje (no cambiar): estudiar rutas es GRATIS siempre; la PRIMERA
//  ruta es gratis de crear, crear más es el SaaS de pago.
// ──────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight, Sparkles, Headphones, Brain, Network,
  Plus, Loader2, Target, Link2, Wand2, CheckCircle2, BarChart3,
  ShieldCheck, FlaskConical, Trash2, Clock, Mail, MessageCircle,
  Crown, Check,
} from "lucide-react";
import { getPublicRouteCard } from "@/app/socialActions";
import type { RouteCard as RouteCardData } from "@/lib/types";
import { Logo, LogoMark } from "@/components/Logo";
import RouteCard from "@/components/RouteCard";

// ── Variables fáciles de editar ─────────────────────────────────────────────
/** Ruta de muestra (pastor Rufat) — se incrusta con su portada real. */
const SAMPLE_ROUTE_ID = "57f7fc66-c220-40a1-981f-28eeaba54d4b";
/** Contacto para colaboraciones a la medida. */
const CORREO = "director@learnfactory.space";
/** WhatsApp en formato internacional sin "+" ni espacios (ej. 5215512345678). */
const WHATSAPP = "573122582098";

const SIGNUP = "/login?mode=signup";
const LOGIN = "/login";

/** Animación de entrada estándar de la marca. */
const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

export default function CreatorsLanding() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [sample, setSample] = useState<RouteCardData | null>(null);
  const [sampleLoaded, setSampleLoaded] = useState(false);

  useEffect(() => {
    getPublicRouteCard(SAMPLE_ROUTE_ID)
      .then(setSample)
      .catch(() => setSample(null))
      .finally(() => setSampleLoaded(true));
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goSignup = () => router.push(SIGNUP);
  const goSample = () => router.push(`/route/${SAMPLE_ROUTE_ID}`);

  const waHref = WHATSAPP ? `https://wa.me/${WHATSAPP}` : null;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50 overflow-x-hidden">
      {/* ── Header propio (sin sesión) ── */}
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
              Crear ruta gratis
            </button>
          </div>
        </div>
      </header>

      {/* ════════════════════ 1 · HERO ════════════════════ */}
      <section className="relative pt-28 md:pt-40 pb-20 md:pb-28">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(139,92,246,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(59,130,246,0.16),transparent_55%)] pointer-events-none" />
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 right-1/4 w-[34rem] h-[34rem] rounded-full bg-primary/20 blur-[140px] pointer-events-none"
        />
        <LogoMark className="hidden md:block absolute -right-24 top-10 w-[30rem] h-[30rem] opacity-[0.05] rotate-12 pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto px-4 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="max-w-2xl order-2 lg:order-1"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-5">
              <Crown className="w-4 h-4" /> Para creadores fundadores
            </span>

            <motion.h1
              initial={{ opacity: 0, y: 20, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.1, duration: 0.8, ease: "easeOut" }}
              className="text-4xl md:text-[4.1rem] md:leading-[1.04] font-bold tracking-tight mb-6"
            >
              Tu audiencia ha perdido años en el scroll.{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary">
                Tú puedes devolvérselos.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="text-zinc-400 text-lg md:text-xl mb-9 max-w-2xl leading-relaxed"
            >
              Convierte tu contenido en rutas que de verdad estudian y recuerdan —
              no que ven y olvidan.
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
                Crear mi primera ruta gratis <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={goSample}
                className="inline-flex items-center gap-2 bg-white/5 border border-zinc-700 hover:border-zinc-500 text-white rounded-full px-7 py-4 text-base font-bold transition-all backdrop-blur-sm"
              >
                Ver un ejemplo en vivo
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.8 }}
              className="mt-10 pt-6 border-t border-zinc-800/60 flex flex-wrap items-center gap-x-7 gap-y-2.5 text-xs text-zinc-500"
            >
              <span className="inline-flex items-center gap-2"><LogoMark className="w-4 h-4" /> Tu primera ruta, gratis</span>
              <span className="inline-flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-primary/70" /> Tu audiencia estudia gratis</span>
              <span className="inline-flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-secondary/70" /> Sin editar · sin programar</span>
            </motion.div>
          </motion.div>

          {/* Visual: persona hipnotizada por el scroll */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.9, ease: "easeOut" }}
            className="relative order-1 lg:order-2"
          >
            <div className="absolute inset-6 bg-primary/20 blur-[90px] rounded-full pointer-events-none" />
            <ImageSlot
              src="/creadores/hero.webp"
              alt="Persona con la mirada vacía, hipnotizada por el scroll de su teléfono"
              caption="Persona con mirada vacía, hipnotizada por el scroll"
              className="relative rounded-[1.75rem] border border-zinc-800 shadow-2xl shadow-black/50 aspect-[4/3]"
              priority
            />
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 2 · EL PROBLEMA ════════════════ */}
      <section className="relative py-20 md:py-28 border-y border-zinc-800/60">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <motion.span {...fadeUp} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-accent/90 mb-5">
            <Brain className="w-4 h-4" /> El problema
          </motion.span>
          <motion.h2 {...fadeUp} className="text-3xl md:text-5xl font-bold tracking-tight mb-7 leading-tight max-w-3xl mx-auto">
            Tu comunidad te ve… y te olvida en{" "}
            <span className="text-zinc-500">tres días.</span>
          </motion.h2>
          <motion.p {...fadeUp} className="text-zinc-400 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto">
            No porque tu contenido sea malo, sino porque las redes están hechas para
            deslizar, no para aprender.
          </motion.p>
        </div>
      </section>

      {/* ════════════════ 3 · EL SUEÑO ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <motion.div {...fadeUp} className="order-2 md:order-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-4">
              <Sparkles className="w-4 h-4" /> El sueño
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-5 leading-tight">
              Enseña a un nivel que nunca viste.
            </h2>
            <p className="text-zinc-400 text-lg leading-relaxed">
              Ya enseñas. Pero imagina que tu audiencia no solo te escuche: que{" "}
              <span className="text-zinc-200 font-semibold">domine</span> lo que enseñas.
              Que responda, practique, avance y vuelva. Dejas de ser el creador que
              entretiene y te vuelves{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary font-semibold">
                el maestro que transforma
              </span>{" "}
              — a un nivel que ni los cursos pagados logran.
            </p>
          </motion.div>
          <motion.div {...fadeUp} className="relative order-1 md:order-2">
            <div className="absolute -inset-4 bg-primary/15 blur-[80px] rounded-full pointer-events-none" />
            <ImageSlot
              src="/creadores/sueno.webp"
              alt="Creador frente a su comunidad, todos avanzando y dominando — transformación"
              caption="Creador frente a su comunidad, todos avanzando / dominando"
              className="relative rounded-[1.75rem] border border-zinc-800 shadow-2xl shadow-black/50 aspect-[4/3]"
            />
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 4 · LA PRUEBA ════════════════ */}
      <section className="relative py-20 md:py-28 border-y border-zinc-800/60 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.10),transparent_60%)]">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <motion.span {...fadeUp} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-secondary/90 mb-4">
            <Target className="w-4 h-4" /> La prueba
          </motion.span>
          <motion.h2 {...fadeUp} className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            No te lo contamos. Míralo.
          </motion.h2>
          <motion.p {...fadeUp} className="text-zinc-400 text-lg mb-12 max-w-2xl mx-auto">
            Esto es una enseñanza pública del pastor Rufat, convertida en una ruta que
            se estudia. Ábrela y mira la diferencia:
          </motion.p>

          {/* Portada real de la ruta — tal cual aparece en la página de inicio */}
          <motion.div {...fadeUp} className="flex flex-col items-center gap-8">
            <div className="relative">
              <div className="absolute -inset-6 bg-primary/20 blur-[70px] rounded-full pointer-events-none" />
              <div className="relative scale-100 sm:scale-125 origin-center my-2 sm:my-6">
                {!sampleLoaded ? (
                  <div className="w-60 aspect-video rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-zinc-600 animate-spin" />
                  </div>
                ) : sample ? (
                  <RouteCard route={sample} />
                ) : (
                  // Fallback si la ruta no estuviera pública: botón directo.
                  <button
                    onClick={goSample}
                    className="w-60 aspect-video rounded-xl bg-gradient-to-br from-primary/25 to-secondary/20 border border-zinc-800 hover:border-primary/60 flex items-center justify-center text-white font-bold transition-colors"
                  >
                    Abrir la ruta de muestra
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={goSample}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-8 py-4 text-base font-bold transition-all shadow-[0_0_34px_rgba(139,92,246,0.4)] hover:shadow-[0_0_52px_rgba(139,92,246,0.55)]"
            >
              Ver ejemplo en vivo <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 5 · POR QUÉ FUNCIONA (gamificación + stats) ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-14 max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-amber-400/90 mb-4">
              <Sparkles className="w-4 h-4" /> Por qué funciona
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              La gamificación lo cambia todo.
            </h2>
            <p className="text-zinc-400 text-lg">
              No es un adorno: es la diferencia entre olvidar y dominar.
            </p>
          </motion.div>

          {/* Contraste 10% vs 75% — números grandes */}
          <div className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto mb-6">
            <StatCard
              pct={10}
              label="Aprendizaje pasivo"
              sub="Solo ver. La gente recuerda apenas el 10%."
              tone="muted"
            />
            <StatCard
              pct={75}
              label="Aprendizaje activo y gamificado"
              sub="Participar y retarse. La gente recuerda el 75%."
              tone="primary"
            />
          </div>

          {/* Refuerzo: +45% retención / +54% resultados */}
          <motion.div {...fadeUp} className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {[
              { big: "+45%", label: "de retención frente a lo pasivo" },
              { big: "+54%", label: "en resultados frente a lo pasivo" },
            ].map((s) => (
              <div key={s.big} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 py-7 text-center">
                <div className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary mb-1">
                  {s.big}
                </div>
                <p className="text-zinc-400 text-sm">{s.label}</p>
              </div>
            ))}
          </motion.div>

          <motion.p {...fadeUp} className="text-center text-zinc-300 text-lg font-semibold mt-12 max-w-2xl mx-auto">
            Tu contenido, gamificado, no se ve mejor: <span className="text-white">se aprende de verdad.</span>
          </motion.p>
        </div>
      </section>

      {/* ════════════════ 6 · CÓMO FUNCIONA ════════════════ */}
      <section className="relative py-20 md:py-28 border-y border-zinc-800/60">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-14 max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary/90 mb-4">
              <Wand2 className="w-4 h-4" /> Cómo funciona
            </span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Un minuto tuyo. El resto lo hace el software.
            </h2>
            <p className="text-zinc-400 text-lg">Sin editar. Sin programar. Sin equipo.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Link2, n: "1", title: "Pegas tus links de YouTube", desc: "Tus videos de siempre, los que ya creaste." },
              { icon: Wand2, n: "2", title: "Escribes un prompt para la portada", desc: "Una línea y la IA diseña la imagen de tu ruta." },
              { icon: CheckCircle2, n: "3", title: "Listo", desc: "En un minuto terminaste tú. La estructura, los quizzes y la gamificación los hace nuestro software." },
            ].map((s) => (
              <motion.div
                key={s.n}
                {...fadeUp}
                className="relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7 hover:border-zinc-700 transition-colors"
              >
                <span className="absolute top-5 right-6 text-5xl font-bold text-zinc-800 select-none">{s.n}</span>
                <s.icon className="w-9 h-9 text-primary mb-5" />
                <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ 7 · LA GRAND SLAM OFFER (centro visual) ════════════════ */}
      <section className="relative py-20 md:py-28 scroll-mt-16">
        {/* Aura premium */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.18),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(59,130,246,0.12),transparent_55%)] pointer-events-none" />
        <motion.div
          animate={{ opacity: [0.25, 0.5, 0.25] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-24 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full bg-primary/15 blur-[150px] pointer-events-none"
        />

        <div className="relative z-10 max-w-5xl mx-auto px-4">
          <motion.div
            {...fadeUp}
            className="relative rounded-[2.25rem] border border-primary/30 bg-zinc-950/80 backdrop-blur-sm shadow-[0_0_80px_rgba(139,92,246,0.18)] overflow-hidden"
          >
            {/* Línea de luz superior */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

            <div className="px-6 sm:px-10 md:px-14 py-12 md:py-16">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.2em] text-primary mb-4">
                  <Crown className="w-4 h-4" /> La Grand Slam Offer
                </span>
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
                  Todo esto, por entrar ahora.
                </h2>
              </div>

              {/* Los dos beneficios de entrada */}
              <div className="grid sm:grid-cols-2 gap-4 mb-12 max-w-3xl mx-auto">
                {[
                  { title: "Tu primera ruta, gratis", desc: "La armas en un minuto." },
                  { title: "Tu audiencia la estudia gratis", desc: "Para siempre." },
                ].map((b) => (
                  <div key={b.title} className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-5 py-4">
                    <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-white">{b.title}</p>
                      <p className="text-zinc-400 text-sm">{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tres formas de dominar tu contenido — trío visual */}
              <p className="text-center text-sm font-bold uppercase tracking-[0.18em] text-zinc-500 mb-6">
                Tres formas de dominar tu contenido
              </p>
              <div className="grid md:grid-cols-3 gap-5 mb-12">
                <ModeCard
                  src="/creadores/rutas.webp"
                  alt="Estudiante respondiendo retos interactivos"
                  badge="Rutas"
                  badgeIcon={Target}
                  badgeColor="text-primary"
                  title="Estudio activo"
                  desc="Juegos de atención, preguntas y debates donde el conocimiento se fija de verdad y la retención se dispara."
                />
                <ModeCard
                  src="/creadores/podcast.webp"
                  alt="Persona escuchando con audífonos"
                  badge="Modo Podcast"
                  badgeIcon={Headphones}
                  badgeColor="text-violet-300"
                  title="Aprendizaje pasivo"
                  desc="Tus lecciones en audio para aprender mientras manejan, entrenan o caminan."
                />
                <ModeCard
                  src="/creadores/tunnel.webp"
                  alt="Corredor neuronal en 3D de nodos conectados"
                  badge="Túnel Neuronal"
                  badgeIcon={Network}
                  badgeColor="text-cyan-300"
                  title="Conexión de ideas"
                  desc="Una experiencia que conecta conceptos entre rutas distintas, para que tu audiencia entienda cómo todo se relaciona."
                />
              </div>

              {/* Y además */}
              <div className="grid sm:grid-cols-2 gap-4 mb-12 max-w-3xl mx-auto">
                {[
                  { icon: BarChart3, title: "Prueba de aprendizaje", desc: "Deja de adivinar si te ven. Ve exactamente quién está avanzando de verdad, gracias a la gamificación." },
                  { icon: Sparkles, title: "Early access a monetización", desc: "Entras primero cuando abramos los acuerdos con marcas y patrocinios." },
                ].map((b) => (
                  <div key={b.title} className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
                    <b.icon className="w-5 h-5 text-secondary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-white">{b.title}</p>
                      <p className="text-zinc-400 text-sm">{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Doble garantía */}
              <div className="grid sm:grid-cols-2 gap-4 mb-10 max-w-3xl mx-auto">
                <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-5 py-4">
                  <FlaskConical className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-white">Respaldada por la ciencia</p>
                    <p className="text-zinc-400 text-sm">El aprendizaje gamificado supera por goleada al pasivo: recuerdan 75% vs. 10%. No es opinión, es evidencia.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 px-5 py-4">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-white inline-flex items-center gap-2">Cero riesgo <Trash2 className="w-4 h-4 text-zinc-500" /></p>
                    <p className="text-zinc-400 text-sm">Si no te llena, la borras y listo. Sin costo, sin compromiso.</p>
                  </div>
                </div>
              </div>

              {/* Escasez + CTA */}
              <div className="text-center">
                <p className="inline-flex items-center gap-2 text-amber-300/90 text-sm font-semibold mb-6">
                  <Clock className="w-4 h-4" /> Solo para los primeros creadores fundadores.
                </p>
                <div>
                  <button
                    onClick={goSignup}
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-10 py-4 text-lg font-bold transition-all shadow-[0_0_40px_rgba(139,92,246,0.45)] hover:shadow-[0_0_60px_rgba(139,92,246,0.6)]"
                  >
                    <Plus className="w-5 h-5" /> Crear mi primera ruta gratis
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Colaboraciones a la medida */}
          <motion.div
            {...fadeUp}
            className="mt-8 rounded-[1.75rem] border border-zinc-800 bg-zinc-900/40 px-6 sm:px-10 py-8 text-center"
          >
            <p className="text-zinc-300 text-base md:text-lg max-w-2xl mx-auto mb-6">
              ¿Quieres que construyamos algo más grande juntos —una colaboración a la
              medida, monetizar en conjunto, o lo que se nos ocurra? Esto no es un
              formulario. Escríbeme directo y hablamos persona a persona.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={`mailto:${CORREO}`}
                className="inline-flex items-center gap-2 bg-white/5 border border-zinc-700 hover:border-zinc-500 text-white rounded-full px-6 py-3 font-semibold transition-colors"
              >
                <Mail className="w-4 h-4" /> {CORREO}
              </a>
              {waHref && (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 rounded-full px-6 py-3 font-semibold transition-colors"
                >
                  <MessageCircle className="w-4 h-4" /> WhatsApp
                </a>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 8 · CIERRE ════════════════ */}
      <section className="relative py-24 md:py-32 border-t border-zinc-800/60">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.16),transparent_60%)] pointer-events-none" />
        <div className="relative z-10 max-w-3xl mx-auto px-4 text-center">
          <motion.div {...fadeUp}>
            <LogoMark className="w-14 h-14 mx-auto mb-7" glow />
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6 leading-tight">
              Tu audiencia va a seguir scrolleando, pase lo que pase.
            </h2>
            <p className="text-zinc-400 text-lg md:text-xl mb-9 max-w-2xl mx-auto leading-relaxed">
              La única pregunta es si ese tiempo se lo queda el algoritmo… o lo
              aprovechas tú para enseñarles algo que de verdad recuerden.
            </p>
            <button
              onClick={goSignup}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-full px-10 py-4 text-lg font-bold transition-all shadow-[0_0_40px_rgba(139,92,246,0.45)] hover:shadow-[0_0_60px_rgba(139,92,246,0.6)]"
            >
              Empezar <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ FOOTER ════════════════ */}
      <footer className="border-t border-zinc-800/60 py-10">
        <div className="max-w-6xl mx-auto px-4 flex flex-col items-center gap-6">
          <div className="w-full flex flex-col md:flex-row items-center justify-between gap-6">
            <Logo className="h-7" />
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-400">
              <button onClick={() => router.push(LOGIN)} className="hover:text-white transition-colors">Iniciar sesión</button>
              <button onClick={goSignup} className="hover:text-white transition-colors">Crear ruta</button>
              <button onClick={goSample} className="hover:text-white transition-colors">Ver ejemplo</button>
            </nav>
          </div>
          <div className="w-full pt-6 border-t border-zinc-800/60 flex flex-col-reverse sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-zinc-600">© {new Date().getFullYear()} LearnFactory. Todos los derechos reservados.</p>
            <nav className="flex items-center gap-5 text-xs text-zinc-500">
              <button onClick={() => router.push("/terminos")} className="hover:text-zinc-300 transition-colors">Términos y condiciones</button>
              <button onClick={() => router.push("/privacidad")} className="hover:text-zinc-300 transition-colors">Política de privacidad</button>
            </nav>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ──────────────────────────────────────────────────
//  PIEZAS
// ──────────────────────────────────────────────────

/** Slot de imagen con la descripción de referencia visible (para iterar el arte). */
function ImageSlot({
  src, alt, caption, className = "", priority = false,
}: { src: string; alt: string; caption: string; className?: string; priority?: boolean }) {
  return (
    <div className={`group relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 w-full h-full object-cover select-none"
        loading={priority ? "eager" : "lazy"}
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
      <span className="absolute bottom-2 left-2 right-2 text-[10px] leading-tight text-zinc-400/70 bg-zinc-950/50 backdrop-blur-sm rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        IMAGEN: {caption}
      </span>
    </div>
  );
}

/** Stat de contraste 10% vs 75% — número grande + barra animada. */
function StatCard({
  pct, label, sub, tone,
}: { pct: number; label: string; sub: string; tone: "muted" | "primary" }) {
  const primary = tone === "primary";
  return (
    <motion.div
      {...fadeUp}
      className={`relative rounded-2xl border p-7 ${
        primary ? "border-primary/40 bg-primary/5" : "border-zinc-800 bg-zinc-900/50"
      }`}
    >
      <div className="flex items-end justify-between mb-4">
        <span
          className={`text-6xl md:text-7xl font-bold leading-none ${
            primary
              ? "text-transparent bg-clip-text bg-gradient-to-r from-primary via-violet-400 to-secondary"
              : "text-zinc-600"
          }`}
        >
          {pct}%
        </span>
        <span className="text-xs text-zinc-500 mb-2">recuerdo</span>
      </div>
      <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden mb-4">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.15 }}
          className={`h-full rounded-full ${
            primary ? "bg-gradient-to-r from-primary to-accent" : "bg-zinc-600"
          }`}
        />
      </div>
      <p className={`font-bold mb-1 ${primary ? "text-white" : "text-zinc-300"}`}>{label}</p>
      <p className="text-zinc-500 text-sm leading-relaxed">{sub}</p>
    </motion.div>
  );
}

/** Tarjeta de uno de los tres modos (trío visual de la oferta). */
function ModeCard({
  src, alt, badge, badgeIcon: BadgeIcon, badgeColor, title, desc,
}: {
  src: string; alt: string; badge: string;
  badgeIcon: React.ComponentType<{ className?: string }>;
  badgeColor: string; title: string; desc: string;
}) {
  return (
    <motion.div
      {...fadeUp}
      className="group relative rounded-2xl overflow-hidden border border-zinc-800 bg-[#0a0712] min-h-[19rem] flex flex-col"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 w-full h-full object-cover opacity-80 transition-transform duration-700 group-hover:scale-105 select-none"
        loading="lazy"
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0712] via-[#0a0712]/75 to-[#0a0712]/15" />
      <div className="relative z-10 mt-auto p-6">
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] mb-2 ${badgeColor}`}>
          <BadgeIcon className="w-3.5 h-3.5" /> {badge}
        </span>
        <h3 className="text-lg font-bold mb-1.5">{title}</h3>
        <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  );
}
