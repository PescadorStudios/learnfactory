"use client";

// Ficha pública del reto: premios por posición (mayor destacado), reglas,
// precio, inscripción (pago Bold / gratis / código de cupo), leaderboard
// público y sección de ganadores. Los anónimos ven todo; para entrar se pide
// login. Un participante ve además su progreso y qué premio ganaría YA.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Trophy,
  Crown,
  Medal,
  Clock,
  Users,
  Ticket,
  ShieldCheck,
  BookOpen,
  Loader2,
  ChevronRight,
  Gift,
  ScrollText,
  Infinity as InfinityIcon,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { getRetoPublic, redeemCupo, joinRetoGratis } from "@/app/retoActions";
import RetoCheckout from "@/components/RetoCheckout";
import type { RetoPublicData, RetoLeaderboardEntry } from "@/lib/types";
import { premioTipoLabel } from "@/lib/types";

function precioLabel(precio: number, moneda: string): string {
  if (precio <= 0) return "Gratis";
  return moneda === "USD" ? `USD ${precio.toLocaleString("es-CO")}` : `$${precio.toLocaleString("es-CO")} COP`;
}

function fechaLabel(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function diasRestantes(fechaFin: string | null): number | null {
  if (!fechaFin) return null;
  const ms = new Date(fechaFin).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/40" },
  publicado: { label: "Inscripciones abiertas", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
  en_curso: { label: "En curso", cls: "bg-primary/15 text-primary border-primary/40" },
  finalizado: { label: "Finalizado", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
};

export default function RetoPublicClient({ retoId }: { retoId: string }) {
  const router = useRouter();
  const { token, email, loading: authLoading } = useAuth();
  const [reto, setReto] = useState<RetoPublicData | null>(null);
  const [loading, setLoading] = useState(true);

  // Formulario de inscripción (compartido por pago / gratis / cupo)
  const [joining, setJoining] = useState(false);
  const [alias, setAlias] = useState("");
  const [anonimo, setAnonimo] = useState(false);
  const [consent, setConsent] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [cupoCode, setCupoCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await getRetoPublic(token, retoId);
    setReto(data);
    setLoading(false);
  }, [token, retoId]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  const requireLogin = () => router.push(`/login?next=${encodeURIComponent(`/reto/${retoId}`)}`);

  const joinGratis = async () => {
    if (!token) return requireLogin();
    setBusy(true);
    setError(null);
    const res = await joinRetoGratis(token, retoId, { consentContacto: consent, alias, anonimo });
    setBusy(false);
    if (!res.ok) return setError(res.error || "No se pudo completar la inscripción.");
    setJoining(false);
    load();
  };

  const canjear = async () => {
    if (!token) return requireLogin();
    if (!cupoCode.trim()) return setError("Escribe tu código de cupo.");
    setBusy(true);
    setError(null);
    const res = await redeemCupo(token, retoId, cupoCode, { consentContacto: consent, alias, anonimo });
    setBusy(false);
    if (!res.ok) return setError(res.error || "No se pudo canjear el código.");
    setJoining(false);
    setCupoCode("");
    load();
  };

  if (loading || authLoading) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </main>
    );
  }

  if (!reto) {
    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white gap-4 p-6">
        <Trophy className="w-12 h-12 text-zinc-600" />
        <h1 className="text-2xl font-bold">Reto no encontrado</h1>
        <p className="text-zinc-400">Puede que el enlace esté mal o el reto aún no se haya publicado.</p>
        <button onClick={() => router.push("/")} className="mt-2 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary-hover transition-colors">
          Ir al inicio
        </button>
      </main>
    );
  }

  const badge = ESTADO_BADGE[reto.estadoEfectivo] ?? ESTADO_BADGE.publicado;
  const dias = diasRestantes(reto.fechaFin);
  const abierto = reto.estadoEfectivo === "publicado" || reto.estadoEfectivo === "en_curso";
  const inscrito = Boolean(reto.miProgreso);

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden">
        {reto.imagenUrl && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center opacity-25 blur-sm scale-105"
              style={{ backgroundImage: `url(${reto.imagenUrl})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/60 via-zinc-950/80 to-zinc-950" />
          </>
        )}
        <div className="relative z-10 max-w-5xl mx-auto px-5 pt-10 pb-8 md:pt-16">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            {reto.imagenUrl && (
              <motion.img
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                src={reto.imagenUrl}
                alt={reto.titulo}
                className="w-full md:w-80 aspect-video object-cover rounded-2xl border border-zinc-800 shadow-2xl shadow-primary/10"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${badge.cls}`}>
                  {badge.label}
                </span>
                {dias !== null && abierto && (
                  <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-800/80 text-zinc-300 border border-zinc-700">
                    <Clock className="w-3.5 h-3.5" /> {dias === 0 ? "Último día" : `${dias} días restantes`}
                  </span>
                )}
              </div>
              <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-3">{reto.titulo}</h1>
              {reto.descripcion && <p className="text-zinc-300 max-w-2xl mb-4">{reto.descripcion}</p>}
              <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
                <span className="flex items-center gap-2">
                  {reto.creator.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={reto.creator.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs text-primary font-bold">
                      {(reto.creator.displayName || reto.creator.username || "?")[0]?.toUpperCase()}
                    </span>
                  )}
                  Reto de <span className="text-white font-semibold">{reto.creator.displayName || reto.creator.username}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" /> {reto.inscritos.toLocaleString("es-CO")} inscritos
                </span>
                <span className="flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4" /> {reto.totalLecciones} lecciones
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" /> Cierra el {fechaLabel(reto.fechaFin)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 pb-20 grid md:grid-cols-[1fr_360px] gap-8 items-start">
        {/* ── Columna principal ── */}
        <div className="space-y-8 min-w-0">
          {/* Ganadores */}
          {reto.ganadores.length > 0 && (
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold mb-4">
                <Crown className="w-5 h-5 text-amber-400" /> Ganadores
              </h2>
              <div className="space-y-2">
                {reto.ganadores.map(g => (
                  <LeaderRow key={`${g.nombre}-${g.premioPosicion}`} e={g} highlight />
                ))}
              </div>
            </section>
          )}

          {/* Premios */}
          <section>
            <h2 className="flex items-center gap-2 text-lg font-bold mb-1">
              <Trophy className="w-5 h-5 text-primary" /> Premios
            </h2>
            <p className="text-sm text-zinc-400 mb-4">
              Los primeros en completar el <span className="text-white font-semibold">100% de la ruta con verificación de atención</span> se
              llevan los premios, en orden de llegada.{" "}
              {reto.premiosRestantes > 0 ? (
                <span className="text-emerald-400 font-semibold">
                  {reto.premiosRestantes} de {reto.premios.length} premios siguen disponibles.
                </span>
              ) : (
                <span className="text-amber-400 font-semibold">Todos los premios ya tienen ganador — la ruta sigue abierta.</span>
              )}
            </p>
            <div className="space-y-3">
              {reto.premios.map(p => {
                const ganado = reto.ganadores.some(g => g.premioPosicion === p.posicion);
                const mayor = p.posicion === 1;
                return (
                  <div
                    key={p.id}
                    className={`flex items-start gap-4 rounded-2xl border p-4 ${
                      mayor
                        ? "border-primary/50 bg-primary/10"
                        : "border-zinc-800 bg-zinc-900/50"
                    } ${ganado ? "opacity-60" : ""}`}
                  >
                    <div
                      className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center font-bold ${
                        mayor ? "bg-primary/20 text-primary" : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {mayor ? <Crown className="w-5 h-5" /> : `#${p.posicion}`}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">{p.titulo}</h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
                          {premioTipoLabel(p.tipo)}
                        </span>
                        {ganado && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/40">
                            Ganado
                          </span>
                        )}
                      </div>
                      {p.descripcion && <p className="text-sm text-zinc-400 mt-1">{p.descripcion}</p>}
                    </div>
                  </div>
                );
              })}
              {!reto.premios.length && <p className="text-zinc-500 text-sm">El creador aún no configuró los premios.</p>}
            </div>
          </section>

          {/* Reglas */}
          {reto.reglas && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-bold mb-3">
                <ScrollText className="w-5 h-5 text-primary" /> Reglas del reto
              </h2>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-300 whitespace-pre-wrap">
                {reto.reglas}
              </div>
            </section>
          )}

          {/* Leaderboard */}
          <section>
            <h2 className="flex items-center gap-2 text-lg font-bold mb-3">
              <Medal className="w-5 h-5 text-primary" /> Leaderboard
            </h2>
            {reto.leaderboard.length ? (
              <div className="space-y-2">
                {reto.leaderboard.map((e, i) => (
                  <LeaderRow key={`${e.nombre}-${i}`} e={e} pos={i + 1} />
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">Aún no hay participantes. Sé el primero en entrar.</p>
            )}
          </section>
        </div>

        {/* ── Columna de inscripción ── */}
        <aside className="md:sticky md:top-6 space-y-4">
          {/* Mi progreso */}
          {inscrito && reto.miProgreso && (
            <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5">
              <h3 className="font-bold mb-3 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" /> Tu progreso
              </h3>
              <div className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-300">Verificado</span>
                  <span className="font-bold text-white">{reto.miProgreso.completionPct}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${reto.miProgreso.completionPct}%` }} />
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-1">
                Posición <span className="font-bold text-white">#{reto.miProgreso.posicion}</span> en el leaderboard
              </p>
              {reto.miProgreso.premioPosicion != null ? (
                <p className="text-sm text-amber-400 font-semibold flex items-center gap-1.5">
                  <Crown className="w-4 h-4" /> ¡Ganaste el premio {reto.miProgreso.premioPosicion}: {reto.miProgreso.premioTitulo}!
                </p>
              ) : reto.miProgreso.premioSiTerminaAhora ? (
                <p className="text-sm text-emerald-400">
                  Si terminas ahora te llevas: <span className="font-semibold">{reto.miProgreso.premioSiTerminaAhora.titulo}</span>
                </p>
              ) : (
                <p className="text-sm text-zinc-400">Los premios ya se asignaron, pero la ruta es tuya para siempre.</p>
              )}
              <button
                onClick={() => router.push(`/tree?route=${reto.rutaId}`)}
                className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors"
              >
                Continuar la ruta <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Inscripción */}
          {!inscrito && !reto.soyCreador && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="font-bold">Entrada</h3>
                <span className="text-2xl font-bold text-primary">{precioLabel(reto.precioEntrada, reto.moneda)}</span>
              </div>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5 mb-4">
                <InfinityIcon className="w-3.5 h-3.5 text-emerald-400" />
                Al participar, la ruta queda en tu cuenta para siempre.
              </p>

              {!abierto ? (
                <p className="text-sm text-zinc-500">Este reto ya no acepta inscripciones.</p>
              ) : !joining ? (
                <button
                  onClick={() => (token ? setJoining(true) : requireLogin())}
                  className="w-full px-5 py-3.5 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors"
                >
                  {reto.precioEntrada > 0 ? "Inscribirme al reto" : "Inscribirme gratis"}
                </button>
              ) : (
                <div className="space-y-3">
                  <input
                    value={alias}
                    onChange={e => setAlias(e.target.value)}
                    maxLength={40}
                    placeholder="Alias para el leaderboard (opcional)"
                    className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary"
                  />
                  <label className="flex items-start gap-2.5 text-xs text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={anonimo} onChange={e => setAnonimo(e.target.checked)} className="mt-0.5 accent-[#8b5cf6]" />
                    Aparecer como “Explorador anónimo” en el leaderboard público
                  </label>
                  <label className="flex items-start gap-2.5 text-xs text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-[#8b5cf6]" />
                    Autorizo compartir mi nombre y correo con el creador del reto (para premios y contacto).
                  </label>

                  {reto.precioEntrada > 0 ? (
                    !showCheckout ? (
                      <button
                        onClick={() => setShowCheckout(true)}
                        className="w-full px-5 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors"
                      >
                        Continuar al pago
                      </button>
                    ) : (
                      token && (
                        <RetoCheckout
                          token={token}
                          retoId={retoId}
                          retoTitulo={reto.titulo}
                          email={email}
                          meta={{ consentContacto: consent, alias, anonimo }}
                        />
                      )
                    )
                  ) : (
                    <button
                      onClick={joinGratis}
                      disabled={busy}
                      className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
                    >
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar inscripción
                    </button>
                  )}
                </div>
              )}

              {/* Cupo gratis */}
              {abierto && (
                <div className="mt-5 pt-4 border-t border-zinc-800">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    <Ticket className="w-3.5 h-3.5" /> ¿Tienes un código de cupo gratis?
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={cupoCode}
                      onChange={e => setCupoCode(e.target.value.toUpperCase())}
                      placeholder="RETO-XXXXX"
                      className="flex-1 min-w-0 rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => (token ? canjear() : requireLogin())}
                      disabled={busy}
                      className="px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm font-semibold hover:border-primary/60 transition-colors disabled:opacity-60"
                    >
                      Canjear
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-1">
                    <Gift className="w-3 h-3" /> Entras sin pagar y compites por los premios como cualquiera.
                  </p>
                </div>
              )}

              {error && <p className="text-rose-400 text-sm mt-3">{error}</p>}
            </div>
          )}

          {reto.soyCreador && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
              <p className="text-sm text-zinc-400 mb-3">Este reto es tuyo.</p>
              <button
                onClick={() => router.push(`/retos/${retoId}`)}
                className="w-full px-5 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors"
              >
                Abrir el dashboard
              </button>
            </div>
          )}

          {/* Verificación */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="flex items-center gap-2 font-bold text-sm mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> No es un sorteo. Es mérito.
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Cada lección de audio incluye juegos de atención. Dejar el audio corriendo no cuenta: solo gana quien de verdad
              estudia el contenido.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LeaderRow({ e, pos, highlight }: { e: RetoLeaderboardEntry; pos?: number; highlight?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        highlight || e.premioPosicion != null ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/50"
      }`}
    >
      <span className="w-8 text-center font-bold text-zinc-400 shrink-0">
        {e.premioPosicion != null ? (
          <Crown className="w-4 h-4 text-amber-400 mx-auto" />
        ) : (
          `#${pos ?? "—"}`
        )}
      </span>
      {e.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
      ) : (
        <span className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs text-zinc-400 font-bold shrink-0">
          {e.nombre[0]?.toUpperCase()}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{e.nombre}</p>
        {e.premioPosicion != null && e.premioTitulo && (
          <p className="text-xs text-amber-400 truncate">Premio {e.premioPosicion}: {e.premioTitulo}</p>
        )}
      </div>
      <div className="w-28 shrink-0">
        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
          <span>{e.finalizadoAt ? "Completado" : "Avance"}</span>
          <span className="font-bold text-zinc-200">{e.completionPct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${e.finalizadoAt ? "bg-emerald-500" : "bg-primary"}`}
            style={{ width: `${e.completionPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
