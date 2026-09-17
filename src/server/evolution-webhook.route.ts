import { defineHandler } from "h3";
import { handleEvolutionWebhook } from "./evolution-webhook";

// Endpoint chamado pela Evolution API (configurada via /webhook/set na
// instância) a cada mensagem nova e a cada etiqueta aplicada/removida.
// Autentica por um parâmetro na própria URL (?secret=...) contra a env var
// EVOLUTION_WEBHOOK_SECRET — não depende de header customizado, já que
// suporte a headers no /webhook/set varia entre versões da Evolution API.
// Roda sem sessão de usuário — a instância identifica o cliente.
export default defineHandler(async (event) => {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET;
  const url = new URL(event.req.url);
  const got = url.searchParams.get("secret");
  if (!expected || got !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
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
    const result = await handleEvolutionWebhook(body as { event?: string; instance?: string; data?: unknown });
    return result;
  } catch (err) {
    // 200 mesmo em erro interno: evita que a Evolution API reenvie
    // indefinidamente por causa de um bug nosso, não do payload dela.
    console.error("[evolution-webhook] erro ao processar:", err);
    return new Response(JSON.stringify({ handled: false, reason: "erro interno" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
});
