// Correo automático "tus videos están listos" — se manda UNA sola vez cuando el
// job de generación de cortos (Modo Scroll) termina con todo listo. SOLO servidor.
import "server-only";
import { sendEmail, type SendResult } from "@/lib/email/resend";

export interface VideosReadyInfo {
  topic: string;
  routeUrl: string;
  videosCount: number;
}

/** Envía el correo de "videos listos" al creador vía Resend (EMAIL_FROM). */
export async function sendVideosReadyEmail(to: string, info: VideosReadyInfo): Promise<SendResult> {
  if (!to) return { ok: false, error: "Sin destinatario." };

  const subject = `Los cortos de "${info.topic}" ya están listos 🎬`;
  const text =
    `¡Tus cortos ya están listos!\n\n"${info.topic}" generó ${info.videosCount} corto(s) ` +
    `para el Modo Scroll. Ya puedes verlos en el feed:\n${info.routeUrl}\n\n— Learn Factory`;

  const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b;">
  <h1 style="font-size:20px;margin:0 0 12px;">Tus cortos ya están listos 🎬</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
    <strong>${escapeHtml(info.topic)}</strong> generó ${info.videosCount} corto(s) para el Modo Scroll.
  </p>
  <p style="margin:20px 0;">
    <a href="${info.routeUrl}" style="display:inline-block;background:#a21caf;color:#fff;
       text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
      Ver el feed
    </a>
  </p>
  <p style="font-size:13px;color:#71717a;line-height:1.6;margin:0;">
    Si el botón no funciona, copia este enlace:<br>
    <a href="${info.routeUrl}" style="color:#a21caf;">${info.routeUrl}</a>
  </p>
  <p style="font-size:13px;color:#a1a1aa;margin-top:24px;">— Learn Factory</p>
</div>`;

  return sendEmail({ to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
