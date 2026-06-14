// Envío de correos vía Resend (HTTP API, sin SDK → cero dependencias nuevas).
// SOLO servidor: usa la API key secreta. Nunca importar desde el cliente.
import "server-only";

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface SendOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Dirección a la que responderá el destinatario (por defecto, la de envío). */
  replyTo?: string;
}

/**
 * Manda un correo con Resend. Requiere dos variables de entorno:
 *   RESEND_API_KEY → la API key 're_...'
 *   EMAIL_FROM     → remitente verificado, ej. 'Learn Factory <no-reply@tudominio.com>'
 */
export async function sendEmail(opts: SendOptions): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: "Resend no está configurado (faltan RESEND_API_KEY / EMAIL_FROM)." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: data?.message || `Resend respondió ${res.status}.` };
    }
    return { ok: true, id: data?.id };
  } catch {
    return { ok: false, error: "No se pudo conectar con Resend." };
  }
}

/** Convierte texto plano a un HTML mínimo y seguro (escapa y respeta saltos). */
export function htmlFromText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escaped}</div>`;
}
