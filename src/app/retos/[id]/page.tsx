"use client";

// Dashboard del reto para su creador: leaderboard en tiempo real (% verificado,
// vía de entrada, ganadores), inscritos e ingresos, cupos gratis, imagen con
// Nano Banana, editor del reto y de premios, export CSV de superfans.

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Loader2,
  Users,
  Ticket,
  Wallet,
  Medal,
  Share2,
  Check,
  Rocket,
  ImagePlus,
  Wand2,
  Download,
  Save,
  Pencil,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import {
  getRetoDashboard,
  publishReto,
  updateReto,
  setRetoPremios,
  proposeRetoImagePrompt,
  generateRetoImage,
  exportSuperfansCSV,
} from "@/app/retoActions";
import PremiosEditor, { type PremioDraft } from "@/components/reto/PremiosEditor";
import CuposPanel from "@/components/reto/CuposPanel";
import RetoLeaderboard from "@/components/reto/RetoLeaderboard";
import type { RetoDashboardData, RetoMoneda } from "@/lib/types";

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/40" },
  publicado: { label: "Publicado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
  en_curso: { label: "En curso", cls: "bg-primary/15 text-primary border-primary/40" },
  finalizado: { label: "Finalizado", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
};

function monto(n: number, moneda: string): string {
  return moneda === "USD" ? `USD ${n.toLocaleString("es-CO")}` : `$${n.toLocaleString("es-CO")}`;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RetoDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: retoId } = use(params);
  const router = useRouter();
  const { token, loading: authLoading } = useRequireAuth();
  const [data, setData] = useState<RetoDashboardData | null | undefined>(undefined);
  const [linkCopied, setLinkCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setData(await getRetoDashboard(token, retoId));
  }, [token, retoId]);

  useEffect(() => {
    load();
  }, [load]);

  const publicar = async () => {
    if (!token) return;
    setPublishing(true);
    setError(null);
    const res = await publishReto(token, retoId);
    setPublishing(false);
    if (!res.ok) return setError(res.error || "No se pudo publicar.");
    load();
  };

  const copiarLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/reto/${retoId}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const descargarCSV = async () => {
    if (!token) return;
    const res = await exportSuperfansCSV(token, retoId);
    if (!res.csv) return setError(res.error || "No se pudo exportar.");
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `superfans-${retoId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading || data === undefined) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white gap-3 p-6">
        <Trophy className="w-12 h-12 text-zinc-600" />
        <p className="text-zinc-400">Reto no encontrado (¿es tuyo?).</p>
        <button onClick={() => router.push("/retos")} className="px-6 py-3 rounded-xl bg-primary text-white font-semibold">
          Volver a Mis Retos
        </button>
      </main>
    );
  }

  const { reto } = data;
  const badge = ESTADO_BADGE[reto.estadoEfectivo] ?? ESTADO_BADGE.borrador;
  const ganadores = data.leaderboard.filter(e => e.premioPosicion != null).length;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-5 py-10">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <button onClick={() => router.push("/retos")} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-1">
              ← Mis Retos
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">{reto.titulo}</h1>
              <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-semibold border ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            {reto.rutaStatus === "generating" && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> La ruta se está generando con IA — puedes configurar todo mientras tanto.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              onClick={copiarLink}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                linkCopied ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" : "border-zinc-700 bg-zinc-800/60 hover:border-zinc-500"
              }`}
            >
              {linkCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
              {linkCopied ? "Copiado" : "Copiar link"}
            </button>
            <button
              onClick={() => router.push(`/reto/${retoId}`)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/60 text-sm font-semibold hover:border-zinc-500 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Ver ficha
            </button>
            <button
              onClick={() => router.push(`/tree?route=${reto.rutaId}`)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/60 text-sm font-semibold hover:border-zinc-500 transition-colors"
            >
              <BookOpen className="w-4 h-4" /> Ver ruta
            </button>
            {reto.estado === "borrador" && (
              <button
                onClick={publicar}
                disabled={publishing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
              >
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} Publicar
              </button>
            )}
          </div>
        </div>
        {error && <p className="text-rose-400 text-sm mb-4">{error}</p>}

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard icon={Users} label="Inscritos" value={String(data.inscritos)} sub={`${data.inscritosPago} pago · ${data.inscritosCupo} cupo`} />
          <StatCard icon={Wallet} label="Tus ingresos (80%)" value={monto(data.ingresoCreador, reto.moneda)} sub={`Bruto: ${monto(data.ingresoBruto, reto.moneda)}`} accent />
          <StatCard icon={Medal} label="Ganadores" value={`${ganadores}/${reto.premios.length}`} sub="premios asignados" />
          <StatCard icon={Ticket} label="Cupos gratis" value={`${reto.cuposGratisUsados}/${reto.cuposGratisTotales}`} sub="canjeados" />
        </div>

        <div className="space-y-8">
          {/* ── Leaderboard ── */}
          <section>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Medal className="w-5 h-5 text-primary" /> Leaderboard
              </h2>
              <button
                onClick={descargarCSV}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800/60 text-xs font-semibold hover:border-zinc-500 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Superfans (CSV)
              </button>
            </div>
            <RetoLeaderboard entries={data.leaderboard} />
            <p className="text-[11px] text-zinc-500 mt-2">
              El CSV solo incluye a quienes autorizaron compartir sus datos de contacto al inscribirse.
            </p>
          </section>

          {/* ── Cupos ── */}
          <CuposPanel token={token!} retoId={retoId} cupos={data.cupos} totales={reto.cuposGratisTotales} onRefresh={load} />

          {/* ── Imagen ── */}
          <ImagenSection token={token!} retoId={retoId} imagenUrl={reto.imagenUrl} onDone={load} />

          {/* ── Premios ── */}
          <PremiosSection
            token={token!}
            retoId={retoId}
            initial={reto.premios.map(p => ({ titulo: p.titulo, descripcion: p.descripcion ?? "", tipo: p.tipo }))}
            locked={ganadores > 0}
            onSaved={load}
          />

          {/* ── Editor ── */}
          <EditorSection
            token={token!}
            retoId={retoId}
            initial={{
              titulo: reto.titulo,
              descripcion: reto.descripcion ?? "",
              reglas: reto.reglas ?? "",
              precio: String(reto.precioEntrada),
              moneda: reto.moneda,
              fechaInicio: toLocalInput(reto.fechaInicio),
              fechaFin: toLocalInput(reto.fechaFin),
            }}
            priceLocked={data.inscritos > 0}
            onSaved={load}
          />
        </div>
      </div>
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/50"}`}>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      <p className={`text-xl font-bold ${accent ? "text-emerald-400" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function ImagenSection({ token, retoId, imagenUrl, onDone }: { token: string; retoId: string; imagenUrl: string | null; onDone: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [proposing, setProposing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proponer = async () => {
    setProposing(true);
    setError(null);
    const res = await proposeRetoImagePrompt(token, retoId);
    setProposing(false);
    if (!res.prompt) return setError(res.error || "No se pudo proponer el prompt.");
    setPrompt(res.prompt);
  };

  const generar = async () => {
    setGenerating(true);
    setError(null);
    const res = await generateRetoImage(token, retoId, prompt);
    setGenerating(false);
    if (!res.imagenUrl) return setError(res.error || "La generación falló.");
    setPreview(`${res.imagenUrl}?v=${Date.now()}`);
    onDone();
  };

  const shown = preview ?? imagenUrl;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="flex items-center gap-2 font-bold mb-3">
        <ImagePlus className="w-5 h-5 text-primary" /> Imagen del reto
      </h2>
      {shown && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown} alt="Imagen del reto" className="w-full max-w-md aspect-video object-cover rounded-xl border border-zinc-800 mb-3" />
      )}
      <div className="space-y-2.5">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          placeholder="Describe la imagen que quieres, o deja que la IA proponga un prompt a partir del título y la descripción."
          className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary resize-none"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={proponer}
            disabled={proposing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/60 text-sm font-semibold hover:border-zinc-500 transition-colors disabled:opacity-60"
          >
            {proposing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Proponer prompt
          </button>
          <button
            onClick={generar}
            disabled={generating || !prompt.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors disabled:opacity-40"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            {shown ? "Regenerar imagen" : "Generar imagen"}
          </button>
        </div>
        {error && <p className="text-rose-400 text-sm">{error}</p>}
        <p className="text-[11px] text-zinc-500">Si no generas una, se usa la portada de la ruta.</p>
      </div>
    </section>
  );
}

function PremiosSection({
  token,
  retoId,
  initial,
  locked,
  onSaved,
}: {
  token: string;
  retoId: string;
  initial: PremioDraft[];
  locked: boolean;
  onSaved: () => void;
}) {
  const [premios, setPremios] = useState<PremioDraft[]>(initial.length ? initial : [{ titulo: "", descripcion: "", tipo: "mentoria" }]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setSaving(true);
    setError(null);
    const res = await setRetoPremios(token, retoId, premios.filter(p => p.titulo.trim()));
    setSaving(false);
    if (!res.ok) return setError(res.error || "No se pudo guardar.");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  };

  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg font-bold mb-3">
        <Trophy className="w-5 h-5 text-primary" /> Premios
      </h2>
      {locked && (
        <p className="text-xs text-amber-400 mb-3">Ya hay premios ganados: la lista quedó bloqueada para proteger el reto.</p>
      )}
      <PremiosEditor premios={premios} onChange={setPremios} disabled={locked} />
      {!locked && (
        <button
          onClick={guardar}
          disabled={saving}
          className="mt-3 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          Guardar premios
        </button>
      )}
      {error && <p className="text-rose-400 text-sm mt-2">{error}</p>}
    </section>
  );
}

function EditorSection({
  token,
  retoId,
  initial,
  priceLocked,
  onSaved,
}: {
  token: string;
  retoId: string;
  initial: { titulo: string; descripcion: string; reglas: string; precio: string; moneda: RetoMoneda; fechaInicio: string; fechaFin: string };
  priceLocked: boolean;
  onSaved: () => void;
}) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setSaving(true);
    setError(null);
    const res = await updateReto(token, retoId, {
      titulo: f.titulo,
      descripcion: f.descripcion,
      reglas: f.reglas,
      ...(priceLocked ? {} : { precioEntrada: Math.max(0, Math.round(Number(f.precio) || 0)), moneda: f.moneda }),
      fechaInicio: f.fechaInicio ? new Date(f.fechaInicio).toISOString() : null,
      fechaFin: f.fechaFin ? new Date(f.fechaFin).toISOString() : null,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error || "No se pudo guardar.");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="flex items-center gap-2 font-bold mb-4">
        <Pencil className="w-5 h-5 text-primary" /> Editar reto
      </h2>
      <div className="space-y-3">
        <input
          value={f.titulo}
          onChange={e => setF({ ...f, titulo: e.target.value })}
          maxLength={140}
          placeholder="Título"
          className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:border-primary"
        />
        <textarea
          value={f.descripcion}
          onChange={e => setF({ ...f, descripcion: e.target.value })}
          rows={2}
          placeholder="Descripción"
          className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:border-primary resize-none"
        />
        <textarea
          value={f.reglas}
          onChange={e => setF({ ...f, reglas: e.target.value })}
          rows={3}
          placeholder="Reglas visibles (criterio de ganador, desempates)"
          className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:border-primary resize-none"
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Precio de entrada</label>
            <input
              type="number"
              min={0}
              value={f.precio}
              onChange={e => setF({ ...f, precio: e.target.value })}
              disabled={priceLocked}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:border-primary disabled:opacity-50"
            />
            {priceLocked && <p className="text-[10px] text-zinc-500 mt-1">Bloqueado: ya hay inscritos.</p>}
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Moneda</label>
            <div className="flex gap-2">
              {(["COP", "USD"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => !priceLocked && setF({ ...f, moneda: m })}
                  disabled={priceLocked}
                  className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-bold border transition-colors disabled:opacity-50 ${
                    f.moneda === m ? "bg-primary/15 text-primary border-primary/40" : "bg-zinc-800 text-zinc-400 border-zinc-700"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Inicio</label>
            <input
              type="datetime-local"
              value={f.fechaInicio}
              onChange={e => setF({ ...f, fechaInicio: e.target.value })}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:border-primary [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Cierre</label>
            <input
              type="datetime-local"
              value={f.fechaFin}
              onChange={e => setF({ ...f, fechaFin: e.target.value })}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:border-primary [color-scheme:dark]"
            />
          </div>
        </div>
        <button
          onClick={guardar}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          Guardar cambios
        </button>
        {error && <p className="text-rose-400 text-sm">{error}</p>}
      </div>
    </section>
  );
}
