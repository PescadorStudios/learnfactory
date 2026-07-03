"use client";

// ──────────────────────────────────────────────────
//  Landing de captación de creadores — Academia de Retos (/creadores-retos).
//  Copy corto y contundente (la Ecuación de Valor trabaja en el texto, nunca
//  se menciona). Sistema visual: carbón oscuro + atmósfera violeta de la
//  marca; VERDE LIMA reservado EXCLUSIVAMENTE para CTAs y puntos focales.
//  Arco (8 secciones): Hero → Problema → Cómo funciona → "No es un sorteo.
//  Es mérito." → Lo que te llevas → Escasez (5 cupos) → FAQ → CTA final.
//  Los mockups del producto están construidos en CSS (sin imágenes externas);
//  cuando lleguen los assets finales, se reemplazan por <img> en cada sección.
// ──────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Wand2,
  Megaphone,
  Trophy,
  ShieldCheck,
  Wallet,
  Users,
  Package,
  TrendingUp,
  Crown,
  Check,
  ChevronDown,
  MessageCircle,
} from "lucide-react";
import { Logo } from "@/components/Logo";

// ── Variables fáciles de editar ─────────────────────────────────────────────
/** WhatsApp en formato internacional sin "+" ni espacios. */
const WHATSAPP = "573122582098";
/** Mensaje precargado del CTA. */
const WA_MENSAJE = "Hola, soy creador de contenido y quiero montar mi reto de aprendizaje con Learn Factory.";
/** Cupos de creadores fundadores: total y ocupados (gestión MANUAL, sin fake). */
const CUPOS_TOTALES = 5;
const CUPOS_OCUPADOS = 0;

const LIME = "#a3e635"; // verde lima: SOLO CTAs y focos

const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

const waHref = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(WA_MENSAJE)}`;

/** CTA verde lima — el único lugar (junto a los focos) donde vive este color. */
function LimeCTA({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <a
      href={waHref}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 rounded-full px-7 py-4 text-base md:text-lg font-bold text-zinc-950 transition-all hover:scale-[1.03] ${className}`}
      style={{ backgroundColor: LIME, boxShadow: `0 0 32px ${LIME}55` }}
    >
      {children}
    </a>
  );
}

export default function RetosLanding() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50 overflow-x-hidden">
      {/* ── Header ── */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
          scrolled ? "bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/70" : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Logo className="h-7 md:h-8" glow={scrolled} />
          <button
            onClick={() => router.push("/login")}
            className="text-sm font-semibold text-zinc-300 hover:text-white transition-colors px-3 py-2"
          >
            Iniciar sesión
          </button>
        </div>
      </header>

      {/* ════════════════ 1 · HERO — el sueño ════════════════ */}
      <section className="relative pt-28 md:pt-40 pb-16 md:pb-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(139,92,246,0.25),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.12),transparent_55%)] pointer-events-none" />
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 right-1/4 w-[34rem] h-[34rem] rounded-full bg-primary/25 blur-[140px] pointer-events-none"
        />
        <div className="relative max-w-6xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <motion.div {...fadeUp}>
            <h1 className="text-4xl md:text-6xl font-bold leading-[1.05] tracking-tight mb-6">
              Convierte tus videos en retos.
              <br />
              <span className="text-primary">Tu público aprende de verdad.</span>
              <br />
              Tú ganas mientras lo hacen.
            </h1>
            <p className="text-lg md:text-xl text-zinc-400 mb-8 max-w-md">
              Tú no grabas nada. Tú no montas nada. Nosotros lo construimos. Tú solo lo anuncias.
            </p>
            <LimeCTA>
              Quiero mi reto <ArrowRight className="w-5 h-5" />
            </LimeCTA>
          </motion.div>

          {/* Mockup: leaderboard flotante con niebla violeta (CSS, sin assets) */}
          <motion.div {...fadeUp} className="relative">
            <div className="absolute inset-0 -m-8 rounded-full bg-primary/20 blur-[100px] pointer-events-none" />
            <div className="relative rounded-3xl border border-zinc-800 bg-zinc-900/90 backdrop-blur p-5 shadow-2xl rotate-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">Reto en curso · Leaderboard</p>
              {[
                { n: "Valentina R.", p: 100, win: true },
                { n: "Andrés M.", p: 82 },
                { n: "Explorador anónimo", p: 67 },
                { n: "Sofía T.", p: 45 },
              ].map((r, i) => (
                <div key={r.n} className="flex items-center gap-3 py-2.5 border-b border-zinc-800/60 last:border-0">
                  <span className="w-6 text-center text-xs font-bold text-zinc-500">{i + 1}</span>
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: `hsl(${260 + i * 18} 60% ${28 + i * 6}%)` }}
                  >
                    {r.n[0]}
                  </span>
                  <span className="flex-1 text-sm font-semibold truncate">{r.n}</span>
                  {r.win && <Crown className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div className="w-24 h-1.5 rounded-full bg-zinc-800 overflow-hidden shrink-0">
                    <div className="h-full rounded-full" style={{ width: `${r.p}%`, backgroundColor: r.win ? LIME : "#8b5cf6" }} />
                  </div>
                </div>
              ))}
              <div className="mt-4 rounded-2xl border p-3.5 flex items-center gap-3" style={{ borderColor: `${LIME}44`, backgroundColor: `${LIME}0d` }}>
                <Trophy className="w-5 h-5 shrink-0" style={{ color: LIME }} />
                <div>
                  <p className="text-xs text-zinc-400">Premio mayor</p>
                  <p className="text-sm font-bold">Mentoría 1 a 1 con el creador</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 2 · EL PROBLEMA ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 text-center space-y-10">
          {[
            "YouTube te paga centavos por millones de vistas.",
            "Un curso te toma meses de grabar y editar.",
            "Y no sabes quiénes son tus verdaderos fans.",
          ].map((line, i) => (
            <motion.p
              key={line}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.12 }}
              className="text-2xl md:text-4xl font-bold text-zinc-300 leading-snug"
            >
              {line}
            </motion.p>
          ))}
          {/* El superfan enterrado entre miles de vistas */}
          <motion.div {...fadeUp} className="relative h-28 md:h-36" aria-hidden>
            {Array.from({ length: 60 }).map((_, i) => {
              const x = (i * 37) % 100;
              const y = ((i * 53) % 90) + 5;
              const focal = i === 23;
              return (
                <span
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    width: focal ? 8 : 3,
                    height: focal ? 8 : 3,
                    backgroundColor: focal ? LIME : "rgba(139,92,246,0.35)",
                    boxShadow: focal ? `0 0 18px ${LIME}` : "none",
                  }}
                />
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 3 · CÓMO FUNCIONA — esfuerzo cero ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.10),transparent_60%)] pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-4">
          <motion.h2 {...fadeUp} className="text-3xl md:text-5xl font-bold text-center mb-14">
            Tu único trabajo: <span className="text-primary">anunciarlo.</span>
          </motion.h2>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: Wand2, t: "Lo construimos gratis", d: "Convertimos tu contenido en una ruta gamificada y montamos tu reto." },
              { icon: Megaphone, t: "Tú lo anuncias", d: "Un video o una historia. Nada más." },
              { icon: Trophy, t: "Tu público compite", d: "Pagan (o entran con tus cupos gratis), aprenden de verdad y los primeros ganan tus premios." },
            ].map((s, i) => (
              <motion.div
                key={s.t}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.1 }}
                className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-7"
              >
                <div className="w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-5">
                  <s.icon className="w-6 h-6 text-primary" />
                </div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Paso {i + 1}</p>
                <h3 className="text-xl font-bold mb-2">{s.t}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{s.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ 4 · LA DIFERENCIA — certeza ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <motion.div {...fadeUp}>
            <h2 className="text-3xl md:text-5xl font-bold mb-5">
              No es un sorteo.
              <br />
              <span className="text-primary">Es mérito.</span>
            </h2>
            <p className="text-zinc-400 text-lg leading-relaxed mb-4">
              Nuestros juegos de atención garantizan que nadie gana dejando el audio corriendo. El que gana, de verdad se
              estudió tu contenido.
            </p>
            <p className="text-zinc-300 font-semibold">Eso protege tu nombre.</p>
          </motion.div>

          {/* Mockup: verificación de atención en vivo */}
          <motion.div {...fadeUp} className="relative">
            <div className="absolute inset-0 -m-6 rounded-full bg-primary/15 blur-[90px] pointer-events-none" />
            <div className="relative rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-2xl -rotate-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-4">Lección en curso · Juego de atención</p>
              <div className="rounded-2xl bg-zinc-950/80 border border-zinc-800 p-4 mb-4">
                <p className="text-sm text-zinc-300 italic">“…y en ese momento la presión externa provocó la caída…”</p>
                <div className="mt-3 flex gap-2">
                  <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/15 text-primary border border-primary/40">
                    Coincide con el audio
                  </span>
                  <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
                    Es una trampa
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-2xl border p-3.5" style={{ borderColor: `${LIME}44`, backgroundColor: `${LIME}0d` }}>
                <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${LIME}22` }}>
                  <Check className="w-4 h-4" style={{ color: LIME }} />
                </span>
                <p className="text-sm font-bold" style={{ color: LIME }}>
                  Atención verificada
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 5 · LO QUE TE LLEVAS ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(139,92,246,0.12),transparent_55%)] pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-4">
          <motion.h2 {...fadeUp} className="text-3xl md:text-5xl font-bold text-center mb-14">
            Lo que te llevas
          </motion.h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {[
              { icon: Wallet, t: "Ingresos", d: "Te llevas el 80% de cada entrada, directo a tu wallet." },
              { icon: Users, t: "Superfans identificados", d: "Por fin sabes quiénes son, con datos." },
              { icon: Package, t: "Tu contenido convertido en producto", d: "Reutilizable. Tuyo." },
              { icon: TrendingUp, t: "Engagement que el algoritmo premia", d: "Tu audiencia vuelve a tu contenido profundo." },
            ].map((b, i) => (
              <motion.div
                key={b.t}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-7 flex gap-5"
              >
                <div className="w-12 h-12 shrink-0 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
                  <b.icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1">{b.t}</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">{b.d}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Mockup: wallet con desglose 80/20 */}
          <motion.div {...fadeUp} className="mt-10 max-w-md mx-auto rounded-3xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">Tu wallet</p>
            <p className="text-4xl font-bold mb-1" style={{ color: LIME }}>
              $3.824.000
            </p>
            <p className="text-xs text-zinc-500 mb-4">200 entradas · tu 80% de cada pago</p>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden flex">
              <div className="h-full" style={{ width: "80%", backgroundColor: LIME }} />
              <div className="h-full bg-primary/50" style={{ width: "20%" }} />
            </div>
            <div className="flex justify-between text-[11px] text-zinc-500 mt-1.5">
              <span>Tú · 80%</span>
              <span>Plataforma · 20%</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 6 · ESCASEZ — urgencia real ════════════════ */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <motion.h2 {...fadeUp} className="text-3xl md:text-5xl font-bold mb-4">
            Estamos abriendo con los primeros <span className="text-primary">{CUPOS_TOTALES} creadores</span>.
          </motion.h2>
          <motion.p {...fadeUp} className="text-lg text-zinc-400 mb-10">
            Montamos todo gratis para ellos. Cuando se llenan, la lista se cierra.
          </motion.p>
          <motion.div {...fadeUp} className="flex items-center justify-center gap-4 mb-10" aria-label={`${CUPOS_OCUPADOS} de ${CUPOS_TOTALES} cupos ocupados`}>
            {Array.from({ length: CUPOS_TOTALES }).map((_, i) => {
              const ocupado = i < CUPOS_OCUPADOS;
              return (
                <div
                  key={i}
                  className="w-14 h-14 md:w-16 md:h-16 rounded-2xl border flex items-center justify-center"
                  style={
                    ocupado
                      ? { borderColor: "rgba(139,92,246,0.5)", backgroundColor: "rgba(139,92,246,0.15)", boxShadow: "0 0 24px rgba(139,92,246,0.35)" }
                      : { borderColor: `${LIME}55`, backgroundColor: `${LIME}0d` }
                  }
                >
                  {ocupado ? <Check className="w-6 h-6 text-primary" /> : <span className="text-sm font-bold" style={{ color: LIME }}>Libre</span>}
                </div>
              );
            })}
          </motion.div>
          <motion.div {...fadeUp}>
            <LimeCTA>
              Reservar mi cupo <ArrowRight className="w-5 h-5" />
            </LimeCTA>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ 7 · FAQ ════════════════ */}
      <section className="relative py-20 md:py-24">
        <div className="max-w-2xl mx-auto px-4">
          <motion.h2 {...fadeUp} className="text-3xl md:text-4xl font-bold text-center mb-10">
            Preguntas rápidas
          </motion.h2>
          <div className="space-y-3">
            {[
              { q: "¿Cuánto me cuesta?", a: "Nada. Tú cobras las entradas; nosotros montamos todo." },
              { q: "¿Qué hago yo?", a: "Anunciarlo. Nada más." },
              {
                q: "¿Y si mi audiencia no paga?",
                a: "Tienes 10 cupos gratis para que tus seguidores prueben sin pagar, o haces tu primer reto gratuito. Tú fijas el precio.",
              },
              {
                q: "¿Qué premio doy?",
                a: "Tiempo y acceso, no dinero: una mentoría, una colaboración en tu canal, la revisión de un proyecto.",
              },
              {
                q: "¿Mi público realmente aprende?",
                a: "Sí. Se quedan con la ruta para siempre y la verificación de atención garantiza que la estudiaron de verdad.",
              },
            ].map((f, i) => (
              <motion.div key={f.q} {...fadeUp} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                <button
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left font-bold hover:bg-zinc-900 transition-colors"
                >
                  {f.q}
                  <ChevronDown className={`w-5 h-5 text-zinc-500 shrink-0 transition-transform ${faqOpen === i ? "rotate-180" : ""}`} />
                </button>
                {faqOpen === i && <p className="px-5 pb-4 text-zinc-400 text-sm leading-relaxed">{f.a}</p>}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ 8 · CTA FINAL ════════════════ */}
      <section className="relative py-24 md:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.18),transparent_60%)] pointer-events-none" />
        {/* Comunidad como nodos de luz conectados */}
        <motion.div
          animate={{ opacity: [0.25, 0.5, 0.25] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[40rem] h-[20rem] rounded-full bg-primary/20 blur-[120px] pointer-events-none"
        />
        <div className="relative max-w-3xl mx-auto px-4 text-center">
          <motion.h2 {...fadeUp} className="text-4xl md:text-6xl font-bold leading-tight mb-8">
            Convierte a tu audiencia
            <br />
            en <span className="text-primary">tu academia</span>.
          </motion.h2>
          <motion.div {...fadeUp}>
            <LimeCTA className="text-lg">
              <MessageCircle className="w-5 h-5" /> Hablar por WhatsApp
            </LimeCTA>
          </motion.div>
          <motion.p {...fadeUp} className="mt-6 text-xs text-zinc-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Verificación de atención en cada lección. Ganar exige estudiar.
          </motion.p>
        </div>
      </section>

      <footer className="border-t border-zinc-900 py-8 text-center text-xs text-zinc-600">
        Learn Factory · Academia de Retos Verificados
      </footer>
    </main>
  );
}
