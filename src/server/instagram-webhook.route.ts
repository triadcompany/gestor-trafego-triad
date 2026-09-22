import { createHmac, timingSafeEqual } from "node:crypto";
import { defineHandler } from "h3";
import { handleInstagramWebhook, type InstagramWebhookBody } from "./instagram-webhook";

// Endpoint chamado pela Meta — dois métodos:
// - GET: handshake de verificação, feito uma vez ao cadastrar o webhook no
//   painel do app (Meta for Developers → Webhooks → assinar campo `comments`).
// - POST: evento de comentário novo, a cada vez que alguém comenta num post.
//   Corpo assinado com HMAC-SHA256 do App Secret (header
//   x-hub-signature-256) — validado antes de processar qualquer coisa.
export default defineHandler(async (event) => {
  if (event.req.method === "GET") {
    const url = new URL(event.req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && expected && token === expected && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  const rawBody = await event.req.text();
  const signatureValid = verifySignature(rawBody, event.req.headers.get("x-hub-signature-256"));
  if (!signatureValid) {
    return new Response(JSON.stringify({ error: "assinatura inválida" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "corpo inválido" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await handleInstagramWebhook(body as InstagramWebhookBody);
    return result;
  } catch (err) {
    // 200 mesmo em erro interno: evita que a Meta reenvie indefinidamente por
    // causa de um bug nosso, não do payload dela (mesmo raciocínio do
    // webhook da Evolution API).
    console.error("[instagram-webhook] erro ao processar:", err);
    return new Response(JSON.stringify({ handled: false, reason: "erro interno" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
});

function verifySignature(rawBody: string, header: string | null): boolean {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
