// Firma corporativa por defecto para los correos salientes del admin.
// Se usa cuando aún no hay una firma guardada en la base (app_settings).
// HTML pensado para verse bien en el cliente del destinatario (fondo claro).
export const DEFAULT_SIGNATURE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
  <tr><td style="border-top:1px solid #e5e7eb; padding-top:20px;">
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:middle; padding-right:18px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background-color:#0f0f12; border-radius:14px; padding:12px 14px;">
            <img src="https://res.cloudinary.com/deirdgemo/image/upload/v1781192596/IMG_9266_nixp8t.png" alt="Learn Factory" width="130" style="display:block; border:0; width:130px; height:auto;">
          </td></tr></table>
        </td>
        <td style="vertical-align:middle; border-left:3px solid #8b5cf6; padding-left:18px; font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
          <div style="font-size:17px; font-weight:700; color:#111827; letter-spacing:-0.2px;">Mauricio Duque</div>
          <div style="font-size:13px; color:#6b7280; margin-top:2px;">Fundador &middot; Learn Factory</div>
          <div style="margin-top:10px;">
            <a href="https://wa.me/57312282098" style="font-size:13px; color:#8b5cf6; text-decoration:none; font-weight:600;">WhatsApp &middot; +57 312 282 098</a>
          </div>
          <div style="font-size:12px; color:#9ca3af; margin-top:8px;">Aprende cualquier tema con IA y gamificaci&oacute;n</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`;
