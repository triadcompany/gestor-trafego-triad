import { defineHandler } from "h3";
import { runAutomationsTick } from "./automations-core";

// Endpoint chamado por um workflow n8n (Schedule Trigger a cada ~5 min).
// Autentica pelo header x-automation-secret contra a env var AUTOMATION_SECRET.
// Roda sem sessão de usuário — opera cross-org.
export default defineHandler(async (event) => {
  const expected = process.env.AUTOMATION_SECRET;
  const got = event.req.headers.get("x-automation-secret");
  if (!expected || got !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const result = await runAutomationsTick();
  return result;
});
