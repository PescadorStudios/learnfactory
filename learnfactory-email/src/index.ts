import PostalMime from "postal-mime";

// Email Worker: Cloudflare Email Routing entrega aquí cada correo recibido.
// Lo parseamos con postal-mime y lo reenviamos a /api/emails/inbound de la app.
export default {
  async email(message: any, env: any) {
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

    await fetch("https://learnfactory.space/api/emails/inbound", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbound-secret": env.EMAIL_INBOUND_SECRET,
      },
      body: JSON.stringify(payload),
    });
  },
};
