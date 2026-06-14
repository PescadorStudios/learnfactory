import PostalMime from "postal-mime";

// Email Worker: Cloudflare Email Routing entrega aquí cada correo recibido.
// Lo parseamos con postal-mime y lo reenviamos a /api/emails/inbound de la app.
export default {
  async email(message: any, env: any) {
    try {
      const parser = new PostalMime();
      const raw = await new Response(message.raw).arrayBuffer();
      const email = await parser.parse(raw);

      const payload = {
        from: email.from?.address || message.from,
        to: email.to?.map((t: any) => t.address).join(", ") || message.to,
        subject: email.subject || "",
        text: email.text || "",
        html: email.html || "",
        messageId: email.messageId || "",
        inReplyTo: email.inReplyTo || "",
      };

      // Limpia BOM inicial (﻿) + espacios: el pipe de la terminal pudo
      // guardar el secreto con un BOM invisible al frente → causaba 401.
      const secret = (env.EMAIL_INBOUND_SECRET || "").replace(/^﻿/, "").trim();
      const res = await fetch("https://learnfactory.space/api/emails/inbound", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-inbound-secret": secret,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) console.log(`[inbound] fallo: status=${res.status} ${await res.text()}`);
    } catch (e: any) {
      console.log(`[inbound] ERROR: ${e?.stack || e}`);
    }
  },
};
