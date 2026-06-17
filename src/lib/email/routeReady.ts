// Correo automático "tu ruta está lista" — se manda UNA sola vez cuando el job
// de generación termina con todas las lecciones listas. SOLO servidor.
import "server-only";
import { sendEmail, type SendResult } from "@/lib/email/resend";

export interface RouteReadyInfo {
  topic: string;
  routeUrl: string;
  lessonsCount: number;
}

/** Envía el correo de "ruta lista" al creador vía Resend (EMAIL_FROM). */
export async function sendRouteReadyEmail(to: string, info: RouteReadyInfo): Promise<SendResult> {
  if (!to) return { ok: false, error: "Sin destinatario." };

  const subject = `Tu ruta "${info.topic}" ya está lista 🎓`;
  const text =
    `¡Tu ruta ya está lista!\n\n"${info.topic}" terminó de generarse con ` +
    `${info.lessonsCount} lección(es). Ya puedes estudiarla:\n${info.routeUrl}\n\n— Learn Factory`;

  const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b;">
  <h1 style="font-size:20px;margin:0 0 12px;">Tu ruta ya está lista 🎓</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
    <strong>${escapeHtml(info.topic)}</strong> terminó de generarse con
    ${info.lessonsCount} lección(es).
  </p>
  <p style="margin:20px 0;">
    <a href="${info.routeUrl}" style="display:inline-block;background:#4f46e5;color:#fff;
       text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
      Empezar a estudiar
    </a>
  </p>
  <p style="font-size:13px;color:#71717a;line-height:1.6;margin:0;">
    Si el botón no funciona, copia este enlace:<br>
    <a href="${info.routeUrl}" style="color:#4f46e5;">${info.routeUrl}</a>
  </p>
  <p style="font-size:13px;color:#a1a1aa;margin-top:24px;">— Learn Factory</p>
</div>`;

  return sendEmail({ to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
