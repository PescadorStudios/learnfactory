// Lector compartido de la firma corporativa. SOLO servidor.
//
// POR QUÉ UN ARCHIVO NUEVO Y NO signature.ts: ese módulo lo importa un componente
// de CLIENTE (src/components/EmailsTab.tsx, para el botón "restaurar firma por
// defecto"), así que meterle supabaseAdmin/"server-only" rompería el build.
//
// POR QUÉ NO adminGetSignature: esa exige un token de admin y devuelve la firma
// por defecto si no lo hay — inútil para un cron, que no tiene sesión de nadie.

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_SIGNATURE } from "./signature";

export const SIG_KEY = "email_signature";

/**
 * Firma guardada por el admin en `app_settings`, o la de por defecto.
 * Así los correos automáticos usan exactamente la misma firma (con el logo) que
 * el admin ve y edita en el panel.
 */
export async function getSignature(): Promise<string> {
  try {
    const { data } = await supabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", SIG_KEY)
      .maybeSingle();
    return (data?.value ?? "").trim() || DEFAULT_SIGNATURE;
  } catch {
    return DEFAULT_SIGNATURE;
  }
}
