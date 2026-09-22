import { defineHandler, getRouterParam } from "h3";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { instagramFunnelNodes } from "@/db/schema";

// Serve o anexo (ex: PDF) de um bloco "Enviar mensagem" do funil — precisa
// ser uma URL pública porque é assim que a API de mensagens do Instagram
// busca o arquivo pra anexar (não aceita base64 direto no corpo da
// mensagem). Sem sessão de propósito — quem busca é o servidor da Meta; o
// id do nó é um uuid, não adivinhável.
export default defineHandler(async (event) => {
  const nodeId = getRouterParam(event, "nodeId");
  if (!nodeId) return new Response("Not found", { status: 404 });

  const node = await db.query.instagramFunnelNodes.findFirst({ where: eq(instagramFunnelNodes.id, nodeId) });
  if (!node?.fileBase64 || !node.fileMimetype) return new Response("Not found", { status: 404 });

  const buffer = Buffer.from(node.fileBase64, "base64");
  return new Response(buffer, {
    status: 200,
    headers: {
      "content-type": node.fileMimetype,
      "content-disposition": `inline; filename="${(node.fileFilename ?? "arquivo").replace(/"/g, "")}"`,
      "cache-control": "public, max-age=3600",
    },
  });
});
