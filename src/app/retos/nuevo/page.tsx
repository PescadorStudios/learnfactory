"use client";

// Wizard de creación de un reto + su ruta PRIVADA, en un solo flujo:
//   1. La ruta (tema, fuentes, tamaño — consume los créditos normales)
//   2. El reto (título, descripción, reglas, precio, fechas)
//   3. Los premios (lista ordenada; su cantidad = cantidad de ganadores)
// Al crear: la ruta se genera en background y el reto queda en borrador; la
// imagen y los cupos se configuran en el dashboard antes de publicar.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, BookOpen, Gift, ArrowRight, ArrowLeft, Loader2, Link as LinkIcon, Coins } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { createReto } from "@/app/retoActions";
import { setRetoPremios } from "@/app/retoActions";
import { getPlan } from "@/app/socialActions";
import { ROUTE_SIZES, ROUTE_SIZE_SPEC, creditsFor, type RouteSize } from "@/lib/routeSize";
import { ROUTE_CATEGORIES, type RetoMoneda } from "@/lib/types";
import { extractUrls } from "@/lib/urlUtils";
import PremiosEditor, { type PremioDraft } from "@/components/reto/PremiosEditor";

const PASOS = [
  { icon: BookOpen, label: "La ruta" },
  { icon: Trophy, label: "El reto" },
  { icon: Gift, label: "Los premios" },
];

export default function NuevoRetoPage() {
  const router = useRouter();
  const { token } = useRequireAuth();
  const [paso, setPaso] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Paso 1 — la ruta
  const [topic, setTopic] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [size, setSize] = useState<RouteSize>("short");
  const [category, setCategory] = useState("");
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);

  // Paso 2 — el reto
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [reglas, setReglas] = useState("");
  const [precio, setPrecio] = useState("0");
  const [moneda, setMoneda] = useState<RetoMoneda>("COP");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");

  // Paso 3 — premios
  const [premios, setPremios] = useState<PremioDraft[]>([{ titulo: "", descripcion: "", tipo: "mentoria" }]);

  useEffect(() => {
    if (!token) return;
    getPlan(token).then(p => {
      if (p) setAvailableCredits(Math.max(0, p.routeQuota - p.creditsUsed));
    });
  }, [token]);

  const urls = extractUrls(sourcesText);
  const cost = creditsFor(size);
  const paso1Ok = topic.trim().length >= 3 && urls.length > 0;
  const paso2Ok = titulo.trim().length >= 3 && fechaFin.length > 0;
  const premiosOk = premios.some(p => p.titulo.trim());

  const crear = async () => {
    if (!token || creating) return;
    setCreating(true);
    setError(null);
    const res = await createReto(token, {
      titulo,
      descripcion,
      reglas,
      precioEntrada: Math.max(0, Math.round(Number(precio) || 0)),
      moneda,
      fechaInicio: fechaInicio ? new Date(fechaInicio).toISOString() : null,
      fechaFin: fechaFin ? new Date(fechaFin).toISOString() : null,
      topic,
      sources: urls.join(","),
      size,
      category: category || undefined,
    });
    if (!res.retoId) {
      setCreating(false);
      setError(
        res.quotaReached
          ? "No te quedan créditos de creación de rutas. Consigue más créditos e intenta de nuevo."
          : res.error || "No se pudo crear el reto."
      );
      return;
    }
    const validos = premios.filter(p => p.titulo.trim());
    if (validos.length) {
      await setRetoPremios(token, res.retoId, validos.map(p => ({ titulo: p.titulo, descripcion: p.descripcion, tipo: p.tipo })));
    }
    router.push(`/retos/${res.retoId}`);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-2xl mx-auto px-5 py-10">
        <h1 className="text-3xl font-bold mb-2">Crear un reto</h1>
        <p className="text-zinc-400 text-sm mb-8">
          Tu contenido se convierte en una ruta gamificada privada; tu audiencia entra al reto, aprende de verdad y compite por
          tus premios.
        </p>

        {/* Indicador de pasos */}
        <div className="flex items-center gap-2 mb-8">
          {PASOS.map((p, i) => (
            <div key={p.label} className="flex items-center gap-2 flex-1">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border w-full justify-center ${
                  i === paso
                    ? "bg-primary/15 text-primary border-primary/40"
                    : i < paso
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-zinc-900 text-zinc-500 border-zinc-800"
                }`}
              >
                <p.icon className="w-4 h-4" /> {p.label}
              </div>
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── Paso 1: la ruta ── */}
          {paso === 0 && (
            <motion.div key="p1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Tema de la ruta
                </label>
                <input
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  maxLength={140}
                  placeholder='Ej. "Edición de video con CapCut de cero a pro"'
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 placeholder:text-zinc-600 focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Fuentes (links a tus videos, artículos o material)
                </label>
                <textarea
                  value={sourcesText}
                  onChange={e => setSourcesText(e.target.value)}
                  rows={4}
                  placeholder={"Pega uno o más links (YouTube, web...)\nhttps://youtube.com/watch?v=..."}
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
                />
                <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                  <LinkIcon className="w-3 h-3" /> {urls.length} {urls.length === 1 ? "fuente detectada" : "fuentes detectadas"}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Tamaño</label>
                <div className="grid grid-cols-3 gap-2">
                  {ROUTE_SIZES.map(s => {
                    const spec = ROUTE_SIZE_SPEC[s];
                    return (
                      <button
                        key={s}
                        onClick={() => setSize(s)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          size === s ? "border-primary/60 bg-primary/10" : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
                        }`}
                      >
                        <p className="font-bold text-sm">{spec.label}</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{spec.blurb}</p>
                        <p className="text-[11px] text-primary font-semibold mt-1.5 flex items-center gap-1">
                          <Coins className="w-3 h-3" /> {creditsFor(s)} {creditsFor(s) === 1 ? "crédito" : "créditos"}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {availableCredits !== null && (
                  <p className={`text-xs mt-2 ${availableCredits < cost ? "text-rose-400" : "text-zinc-500"}`}>
                    Tienes {availableCredits} {availableCredits === 1 ? "crédito disponible" : "créditos disponibles"}.
                    {availableCredits < cost && " No te alcanzan para este tamaño."}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Categoría (opcional)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROUTE_CATEGORIES.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setCategory(category === c.id ? "" : c.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        category === c.id
                          ? "bg-primary/15 text-primary border-primary/40"
                          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-zinc-500">
                La ruta será <span className="text-white font-semibold">privada</span>: no aparece en el catálogo público. Solo
                se accede entrando a tu reto.
              </p>
            </motion.div>
          )}

          {/* ── Paso 2: el reto ── */}
          {paso === 1 && (
            <motion.div key="p2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Título del reto</label>
                <input
                  value={titulo}
                  onChange={e => setTitulo(e.target.value)}
                  maxLength={140}
                  placeholder='Ej. "Reto: domina la edición en 30 días"'
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 placeholder:text-zinc-600 focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Descripción</label>
                <textarea
                  value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  rows={3}
                  placeholder="Qué van a aprender y por qué vale la pena entrar."
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Reglas (visibles para los participantes)
                </label>
                <textarea
                  value={reglas}
                  onChange={e => setReglas(e.target.value)}
                  rows={3}
                  placeholder={"Ej. Gana quien complete el 100% de la ruta con verificación de atención.\nEmpates: mayor puntaje de atención; luego, quien se inscribió primero."}
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Precio de entrada (0 = gratis)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={precio}
                    onChange={e => setPrecio(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Moneda</label>
                  <div className="flex gap-2">
                    {(["COP", "USD"] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setMoneda(m)}
                        className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold border transition-colors ${
                          moneda === m ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-900 text-zinc-400 border-zinc-800"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Inicio (opcional)</label>
                  <input
                    type="datetime-local"
                    value={fechaInicio}
                    onChange={e => setFechaInicio(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:border-primary [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Cierre del reto</label>
                  <input
                    type="datetime-local"
                    value={fechaFin}
                    onChange={e => setFechaFin(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm focus:outline-none focus:border-primary [color-scheme:dark]"
                  />
                </div>
              </div>
              <p className="text-xs text-zinc-500">
                Te llevas el <span className="text-emerald-400 font-semibold">80% de cada entrada</span>, directo a tu wallet. La
                participación es ilimitada.
              </p>
            </motion.div>
          )}

          {/* ── Paso 3: premios ── */}
          {paso === 2 && (
            <motion.div key="p3" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
              <PremiosEditor premios={premios} onChange={setPremios} />
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p className="text-rose-400 text-sm mt-5">{error}</p>}

        {/* Navegación */}
        <div className="flex items-center justify-between mt-8">
          {paso > 0 ? (
            <button
              onClick={() => setPaso(paso - 1)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Atrás
            </button>
          ) : (
            <span />
          )}
          {paso < 2 ? (
            <button
              onClick={() => setPaso(paso + 1)}
              disabled={paso === 0 ? !paso1Ok : !paso2Ok}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors disabled:opacity-40"
            >
              Continuar <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={crear}
              disabled={creating || !premiosOk}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover transition-colors disabled:opacity-40"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
              Crear reto y generar la ruta
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
