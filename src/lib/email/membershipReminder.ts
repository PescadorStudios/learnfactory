// Correos del ciclo de vida de la membresía MENSUAL. SOLO servidor.
//
// Bold no tiene API de suscripciones (recomiendan tokenizar la tarjeta uno mismo),
// así que la renovación es MANUAL. Estos dos correos son, literalmente, lo que
// sostiene el ingreso recurrente: sin el aviso, la membresía vence en silencio.
//
// Idempotencia: la decide el worker con `renewal_notified_for` /
// `lapsed_notified_for`, que guardan el `premium_until` PARA EL QUE se avisó (ver
// src/lib/sessionBudget.ts). Al renovar, la fecha se mueve y el aviso se re-arma.
import "server-only";
import { sendEmail, type SendResult } from "@/lib/email/resend";
import { getSignature } from "@/lib/email/getSignature";
import { MEMBERSHIP_MONTHLY_LABEL } from "@/lib/pricing";

function shell(title: string, body: string, cta: string, url: string, sig: string): string {
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b;">
  <h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
  ${body}
  <p style="margin:20px 0;">
    <a href="${url}" style="display:inline-block;background:#f59e0b;color:#3f2d00;
       text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:700;">
      ${cta}
    </a>
  </p>
  <p style="font-size:13px;color:#71717a;line-height:1.6;margin:0;">
    Si el botón no funciona, copia este enlace:<br>
    <a href="${url}" style="color:#8b5cf6;">${url}</a>
  </p>
  ${sig}
</div>`;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
}

/** Aviso a 3 días del vencimiento: la oportunidad de renovar sin perder acceso. */
export async function sendMembershipReminderEmail(
  to: string,
  info: { premiumUntil: string; premiumUrl: string; daysLeft: number }
): Promise<SendResult> {
  if (!to) return { ok: false, error: "Sin destinatario." };

  const when = fmt(info.premiumUntil);
  const dias = info.daysLeft === 1 ? "1 día" : `${info.daysLeft} días`;
  const subject = `Tu membresía vence en ${dias}`;
  const text =
    `Tu membresía de Learn Factory vence el ${when}.\n\n` +
    `Si renuevas antes, no pierdes nada: los días se suman a los que ya tienes.\n` +
    `Renovar (${MEMBERSHIP_MONTHLY_LABEL}): ${info.premiumUrl}\n\n` +
    `Si no renuevas, seguirás estudiando gratis por sesiones (con la pausa de 4 horas).\n\n— Learn Factory`;

  const sig = await getSignature();
  const html = shell(
    `Tu membresía vence en ${dias}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
       Tu membresía va hasta el <strong>${when}</strong>. Si renuevas antes, no pierdes nada:
       los 30 días se <strong>suman</strong> a los que ya tienes.
     </p>
     <p style="font-size:14px;line-height:1.6;margin:0;color:#3f3f46;">
       Si no renuevas no pasa nada malo: sigues estudiando gratis por sesiones, con la pausa de 4 horas entre tandas.
     </p>`,
    "Renovar mi membresía",
    info.premiumUrl,
    sig
  );

  return sendEmail({ to, subject, html, text });
}

/** Aviso el día del vencimiento. Sin culpa: solo el camino de vuelta. */
export async function sendMembershipLapsedEmail(
  to: string,
  info: { premiumUrl: string }
): Promise<SendResult> {
  if (!to) return { ok: false, error: "Sin destinatario." };

  const subject = "Tu membresía terminó (puedes volver cuando quieras)";
  const text =
    `Tu membresía de Learn Factory terminó.\n\n` +
    `Sigues teniendo tu cuenta, tu progreso, tu XP y tus rutas creadas. Estudiar sigue siendo gratis, ` +
    `ahora por sesiones con la pausa de 4 horas.\n\n` +
    `Volver a la membresía (${MEMBERSHIP_MONTHLY_LABEL}): ${info.premiumUrl}\n\n— Learn Factory`;

  const sig = await getSignature();
  const html = shell(
    "Tu membresía terminó",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
       Conservas todo: tu cuenta, tu progreso, tu XP y las rutas que creaste.
     </p>
     <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
       Estudiar sigue siendo gratis — ahora por sesiones, con la pausa de 4 horas entre tandas.
       Cuando quieras quitarla otra vez, aquí estamos.
     </p>`,
    "Reactivar mi membresía",
    info.premiumUrl,
    sig
  );

  return sendEmail({ to, subject, html, text });
}
