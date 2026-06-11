"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Settings, LogOut, Crown, Plus, Shield } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getMyProfile, getPlan } from "@/app/socialActions";
import { checkIsAdmin } from "@/app/adminActions";
import { Logo } from "@/components/Logo";

export default function AppHeader({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const { token } = useAuth();
  const [q, setQ] = useState(initialQuery);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<{ username: string | null; avatarUrl: string | null } | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    getMyProfile(token).then(p => p && setProfile({ username: p.username, avatarUrl: p.avatarUrl }));
    getPlan(token).then(p => setIsPremium(p?.plan === "premium"));
    checkIsAdmin(token).then(setIsAdmin);
  }, [token]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
  };

  const logout = async () => {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-900">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-4">
        <button
          onClick={() => router.push("/")}
          className="flex items-center shrink-0 opacity-95 hover:opacity-100 transition-opacity"
          aria-label="Inicio"
        >
          <Logo className="h-8" />
        </button>

        <form onSubmit={submitSearch} className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar rutas, temas..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-full py-2 pl-9 pr-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary transition-all"
          />
        </form>

        <button
          onClick={() => router.push("/sources")}
          className="hidden sm:flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white rounded-full px-4 py-2 text-sm font-bold transition-all shrink-0"
        >
          <Plus className="w-4 h-4" /> Crear ruta
        </button>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="w-9 h-9 rounded-full overflow-hidden border border-zinc-700 bg-zinc-800 flex items-center justify-center hover:border-primary transition-colors"
          >
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <User className="w-4 h-4 text-zinc-400" />
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden py-1">
              {isPremium && (
                <div className="px-4 py-2 flex items-center gap-2 text-amber-400 text-xs font-bold border-b border-zinc-800">
                  <Crown className="w-3.5 h-3.5" /> Premium
                </div>
              )}
              <button
                onClick={() => { setMenuOpen(false); router.push(profile?.username ? `/u/${profile.username}` : "/settings/profile"); }}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
              >
                <User className="w-4 h-4" /> Mi perfil
              </button>
              <button
                onClick={() => { setMenuOpen(false); router.push("/settings/profile"); }}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
              >
                <Settings className="w-4 h-4" /> Ajustes
              </button>
              {isAdmin && (
                <button
                  onClick={() => { setMenuOpen(false); router.push("/admin"); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-primary hover:bg-zinc-800 flex items-center gap-2"
                >
                  <Shield className="w-4 h-4" /> Panel admin
                </button>
              )}
              <button
                onClick={logout}
                className="w-full text-left px-4 py-2.5 text-sm text-rose-400 hover:bg-zinc-800 flex items-center gap-2 border-t border-zinc-800"
              >
                <LogOut className="w-4 h-4" /> Salir
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
