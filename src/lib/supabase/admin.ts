// Cliente de Supabase con service role — SOLO para uso en el servidor.
// Salta RLS: nunca importar desde componentes cliente.
import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return cached;
}

/** Verifica un access token de usuario y devuelve { id, email } o null */
export async function getUserFromToken(token: string): Promise<{ id: string; email: string } | null> {
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email || "" };
}
