"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";

function ResetContent() {
  const router = useRouter();
  // "checking": esperando a que el SDK detecte el token del enlace.
  // "ready": hay sesión de recuperación, mostramos el formulario.
  // "invalid": el enlace caducó o no es válido.
  // "done": contraseña cambiada.
  const [phase, setPhase] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sb = supabaseBrowser();
    // El cliente detecta el token del hash (#access_token=...&type=recovery) al
    // cargar y dispara PASSWORD_RECOVERY. Escuchamos eso y, como respaldo,
    // consultamos la sesión por si ya estaba lista antes de montar.
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && phase === "checking")) {
        setPhase("ready");
      }
    });

    sb.auth.getSession().then(({ data }) => {
      if (data.session) setPhase("ready");
      else setTimeout(() => setPhase((p) => (p === "checking" ? "invalid" : p)), 1500);
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("La contraseña debe tener mínimo 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const { error: updErr } = await sb.auth.updateUser({ password });
      if (updErr) {
        setError("No se pudo actualizar la contraseña. El enlace pudo haber caducado.");
        setBusy(false);
        return;
      }
      setPhase("done");
      // Cerramos la sesión de recuperación para que entre con su nueva clave.
      await sb.auth.signOut();
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-zinc-950">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-secondary/20 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md z-10"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <Logo className="h-14 mb-6" glow />
          <h1 className="text-4xl font-bold">Nueva contraseña</h1>
        </div>

        {phase === "checking" && (
          <div className="flex flex-col items-center gap-4 text-zinc-400 py-10">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p>Verificando tu enlace…</p>
          </div>
        )}

        {phase === "invalid" && (
          <div className="text-center space-y-6">
            <p className="text-zinc-300">
              Este enlace no es válido o ya caducó. Pide uno nuevo desde la pantalla de inicio de sesión.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="text-primary hover:underline text-sm font-semibold"
            >
              ← Ir a iniciar sesión
            </button>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col items-center gap-4 text-center py-6">
            <CheckCircle2 className="w-14 h-14 text-emerald-400" />
            <p className="text-zinc-200 text-lg font-semibold">¡Contraseña actualizada!</p>
            <p className="text-zinc-400 text-sm">Te llevamos a iniciar sesión…</p>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nueva contraseña (mínimo 6)"
              autoComplete="new-password"
              className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl py-4 px-6 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repite la contraseña"
              autoComplete="new-password"
              className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl py-4 px-6 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />

            {error && <p className="text-rose-400 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-4 bg-primary hover:bg-primary-hover text-white font-bold text-lg rounded-2xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Guardando…
                </>
              ) : (
                <>
                  <KeyRound className="w-5 h-5" />
                  Cambiar contraseña
                </>
              )}
            </button>
          </form>
        )}
      </motion.div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-950" />}>
      <ResetContent />
    </Suspense>
  );
}
