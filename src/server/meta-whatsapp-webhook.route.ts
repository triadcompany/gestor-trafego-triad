import { defineHandler } from "h3";
import { handleMetaWhatsappWebhook } from "./meta-whatsapp-webhook";

// Endpoint chamado pela WhatsApp Business Platform oficial da Meta (Cloud
// API) — configurado uma vez no painel de Webhooks do app Meta (fora do
// código), apontando pra essa URL. Dois métodos:
// - GET: handshake de verificação da Meta (hub.challenge) na hora de
//   configurar o webhook no painel.
// - POST: eventos de mensagem de verdade.
// Não tem relação nenhuma com o webhook da Evolution (evolution-webhook.
// route.ts) — rota, secret e lógica totalmente separados.
export default defineHandler(async (event) => {
  if (event.req.method === "GET") {
    const url = new URL(event.req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (mode === "subscribe" && expected && token === expected && challenge) {
      return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.req.json();
  } catch {
    return new Response(JSON.stringify({ error: "corpo inválido" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await handleMetaWhatsappWebhook(body as Parameters<typeof handleMetaWhatsappWebhook>[0]);
    // 200 sempre: Meta reenvia agressivamente em caso de erro/timeout — evita
    // retentativa infinita por causa de um bug nosso, não do payload dela.
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  } catch (err) {
    console.error("[meta-whatsapp-webhook] erro ao processar:", err);
    return new Response(JSON.stringify({ handled: false, reason: "erro interno" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
});
