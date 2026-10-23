// Marca uma campanha como "vendida" — cria uma venda em `sales` (nome do
// carro no campo obs, sem valor, pra preencher depois em /vendas) e avisa o
// grupo configurado com o investimento e as conversas iniciadas da campanha
// desde o início (histórico completo, não só o período filtrado na tela).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, sales, appConfig } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { getMetaToken, fetchCampaignLifetimeStats } from "@/lib/meta";
import { isoDateInBrasilia } from "@/lib/brasilia-date";
import { resolveGestorWhatsappInstance, resolveOperationalGroupId } from "@/lib/whatsapp-messages";

export type CampaignSaleStats = { spend: number; leads: number };

const _fetchCampaignSaleStats = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string(), campaignId: z.string() }))
  .handler(async ({ data }): Promise<CampaignSaleStats> => {
    const { organizationId, role, userId } = await requireOrgContext();
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, ownerUserId: true },
    });
    if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
    const token = await getMetaToken(data.clientId);
    if (!token) throw new Error("Token Meta não encontrado.");
    return fetchCampaignLifetimeStats(data.campaignId, token);
  });

export async function fetchCampaignSaleStats(clientId: string, campaignId: string): Promise<CampaignSaleStats> {
  return _fetchCampaignSaleStats({ data: { clientId, campaignId } });
}

const _markCampaignSold = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), campaignId: z.string(), carName: z.string().min(1) }))
  .handler(async ({ data }): Promise<void> => {
    const { organizationId, role, userId } = await requireOrgContext();
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, ownerUserId: true, name: true, whatsappGroupId: true },
    });
    if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");

    const token = await getMetaToken(data.clientId);
    if (!token) throw new Error("Token Meta não encontrado.");
    const { spend, leads } = await fetchCampaignLifetimeStats(data.campaignId, token);
    const carName = data.carName.trim();

    await db.insert(sales).values({
      clientId: data.clientId,
      date: isoDateInBrasilia(),
      value: null,
      obs: carName,
    });

    const rows = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, "sale_notification_destination")));
    const destination = rows[0]?.value || "operacional";

    // Sempre sai pela instância do GESTOR, nunca pela instância própria do
    // cliente — mesmo quando o destino é o grupo do cliente. Mandar uma
    // automação interna com o número do próprio cliente conectado já causou
    // mensagem saindo do WhatsApp do cliente pra um contato dele, parecendo
    // que o cliente mandou pra si mesmo. "destination" só decide PRA ONDE vai
    // (ver groupId abaixo), nunca de qual número sai.
    const resolved = await resolveGestorWhatsappInstance();
    const { url, apiKey, instance } = resolved;

    const groupId =
      destination === "client_group" && client.whatsappGroupId
        ? client.whatsappGroupId
        : await resolveOperationalGroupId(resolved, organizationId);
    if (!groupId) {
      throw new Error("Grupo operacional não configurado pra essa instância. Configure em Configurações → Instâncias WhatsApp.");
    }

    const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const text = `${carName} vendido.\nInvestimento: ${brl(spend)}\nConversas Iniciadas: ${leads}\n\n${client.name}.`;

    const res = await fetch(`${url}/message/sendText/${instance}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: groupId, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Erro ao enviar mensagem: ${res.status} - ${body}`);
    }
  });

export async function markCampaignSold(clientId: string, campaignId: string, carName: string): Promise<void> {
  await _markCampaignSold({ data: { clientId, campaignId, carName } });
}
