"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "./supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    session,
    loading,
    token: session?.access_token ?? null,
    email: session?.user?.email ?? null,
  };
}

/** Igual que useAuth, pero redirige a /login si no hay sesión (y vuelve aquí tras entrar) */
export function useRequireAuth() {
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (!auth.loading && !auth.session) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.push(next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login");
    }
  }, [auth.loading, auth.session, router]);

  return auth;
}
