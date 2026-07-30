// Correo "ya puedes volver a estudiar" — se manda UNA sola vez cuando se cumplen
// las 4 horas del bloqueo de sesión. SOLO servidor.
//
// Es la pieza de re-enganche del muro: sin este correo, el bloqueo sería solo una
// fricción; con él, cada bloqueo se convierte en una razón programada para volver.
// El enlace lleva a la ÚLTIMA unidad que estaba consumiendo, y en las lecciones el
// borrador de `lesson_progress` hace que reanude justo donde lo dejó.
import "server-only";
import { sendEmail, type SendResult } from "@/lib/email/resend";
import { getSignature } from "@/lib/email/getSignature";
import { MEMBERSHIP_MONTHLY_LABEL } from "@/lib/pricing";

export interface SessionUnlockedInfo {
  /** Enlace directo a donde se quedó. */
  resumeUrl: string;
  /** Título de la lección/corto/episodio pendiente, si se conoce. */
  nextUp?: string | null;
  /** Enlace a la página de membresía. */
  premiumUrl: string;
}

export async function sendSessionUnlockedEmail(
  to: string,
  info: SessionUnlockedInfo
): Promise<SendResult> {
  if (!to) return { ok: false, error: "Sin destinatario." };

  const subject = "Ya puedes volver a estudiar 🎓";
  const nextLine = info.nextUp ? `\n\nTe quedó pendiente: "${info.nextUp}"` : "";
  const text =
    `Se cumplió el tiempo: tu sesión de estudio ya está desbloqueada.${nextLine}\n\n` +
    `Sigue donde lo dejaste:\n${info.resumeUrl}\n\n` +
    `¿No quieres volver a esperar? Hazte miembro por ${MEMBERSHIP_MONTHLY_LABEL} y estudia sin límites: ${info.premiumUrl}\n\n— Learn Factory`;

  const sig = await getSignature();

  const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b;">
  <h1 style="font-size:20px;margin:0 0 12px;">Ya puedes volver a estudiar 🎓</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
    Se cumplió el tiempo: tu sesión ya está <strong>desbloqueada</strong>.
  </p>
  ${
    info.nextUp
      ? `<p style="font-size:15px;line-height:1.6;margin:0 0 8px;color:#3f3f46;">
    Te quedó pendiente: <strong>${escapeHtml(info.nextUp)}</strong>
  </p>`
      : ""
  }
  <p style="margin:20px 0;">
    <a href="${info.resumeUrl}" style="display:inline-block;background:#8b5cf6;color:#fff;
       text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
      Seguir donde lo dejé
    </a>
  </p>
  <p style="font-size:13px;color:#71717a;line-height:1.6;margin:0 0 4px;">
    Si el botón no funciona, copia este enlace:<br>
    <a href="${info.resumeUrl}" style="color:#8b5cf6;">${info.resumeUrl}</a>
  </p>
  <p style="font-size:13px;color:#71717a;line-height:1.6;margin:18px 0 0;">
    ¿No quieres volver a esperar? Con la membresía (${MEMBERSHIP_MONTHLY_LABEL})
    estudias sin límites y creas tus propias rutas con links de YouTube, libros de
    Google Drive o PDFs. <a href="${info.premiumUrl}" style="color:#8b5cf6;font-weight:600;">Ver la membresía</a>
  </p>
  ${sig}
</div>`;

  return sendEmail({ to, subject, html, text: `${text}` });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
