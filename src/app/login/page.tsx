"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, Loader2, LogIn, UserPlus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { registerUser } from "../routeActions";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && session) router.push("/");
  }, [loading, session, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || password.length < 6) {
      setError("Correo válido y contraseña de mínimo 6 caracteres.");
      return;
    }
    if (mode === "signup" && !/^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase())) {
      setError("Elige un usuario de 3-20 caracteres (letras, números o guion bajo).");
      return;
    }
    setBusy(true);

    try {
      const sb = supabaseBrowser();

      if (mode === "signup") {
        const result = await registerUser(email.trim(), password, username.trim());
        if (!result.ok) {
          setError(result.error || "No se pudo crear la cuenta.");
          setBusy(false);
          return;
        }
      }

      const { error: signInErr } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        setError(mode === "signin" ? "Correo o contraseña incorrectos." : signInErr.message);
        setBusy(false);
        return;
      }
      router.push("/");
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
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4 bg-zinc-900/50 border border-zinc-800 px-4 py-2 rounded-full text-zinc-400 text-sm">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>LearnFactory</span>
          </div>
          <h1 className="text-4xl font-bold">
            {mode === "signin" ? "Bienvenido de vuelta" : "Crea tu cuenta"}
          </h1>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 gap-2 mb-6 bg-zinc-900 border border-zinc-800 rounded-2xl p-1.5">
          <button
            onClick={() => { setMode("signin"); setError(""); }}
            className={`py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              mode === "signin" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            <LogIn className="w-4 h-4" /> Iniciar sesión
          </button>
          <button
            onClick={() => { setMode("signup"); setError(""); }}
            className={`py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              mode === "signup" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            <UserPlus className="w-4 h-4" /> Crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            autoComplete="email"
            className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl py-4 px-6 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
          />
          {mode === "signup" && (
            <div className="relative">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-500">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
                placeholder="tu_usuario"
                autoComplete="username"
                maxLength={20}
                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl py-4 pl-10 pr-6 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
            </div>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña (mínimo 6 caracteres)"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl py-4 px-6 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
          />

          {error && (
            <p className="text-rose-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-4 bg-primary hover:bg-primary-hover text-white font-bold text-lg rounded-2xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {mode === "signin" ? "Entrando..." : "Creando cuenta..."}
              </>
            ) : mode === "signin" ? "Entrar" : "Crear cuenta y entrar"}
          </button>
        </form>
      </motion.div>
    </main>
  );
}
