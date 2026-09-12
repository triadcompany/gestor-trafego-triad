import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, saleSuggestions } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { clientAccessCondition, canAccessClient } from "@/lib/client-access";

// Sugestões de venda detectadas por palavra-chave no grupo de WhatsApp do
// cliente (ver automations-core.ts). Nunca viram venda sozinhas — o gestor
// confirma (cria a venda de verdade, ver createSale em lib/queries.ts) ou
// descarta. Escopo por gestor: member só vê sugestões de clientes dele.

export interface SaleSuggestionRow {
  id: string;
  client_id: string;
  client_name: string;
  message_text: string;
  message_at: string;
}

const _fetchPendingSaleSuggestions = createServerFn({ method: "GET" }).handler(
  async (): Promise<SaleSuggestionRow[]> => {
    const { organizationId, role, userId } = await requireOrgContext();
    const rows = await db
      .select({
        id: saleSuggestions.id,
        clientId: saleSuggestions.clientId,
        clientName: clients.name,
        messageText: saleSuggestions.messageText,
        messageAt: saleSuggestions.messageAt,
      })
      .from(saleSuggestions)
      .innerJoin(clients, eq(clients.id, saleSuggestions.clientId))
      .where(
        and(
          eq(saleSuggestions.status, "pending"),
          eq(clients.organizationId, organizationId),
          clientAccessCondition({ role, userId }),
        ),
      )
      .orderBy(saleSuggestions.messageAt);
    return rows.map((r) => ({
      id: r.id,
      client_id: r.clientId,
      client_name: r.clientName,
      message_text: r.messageText,
      message_at: r.messageAt,
    }));
  },
);

export async function fetchPendingSaleSuggestions(): Promise<SaleSuggestionRow[]> {
  return _fetchPendingSaleSuggestions();
}

const _dismissSaleSuggestion = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId, role, userId } = await requireOrgContext();
    const row = await db.query.saleSuggestions.findFirst({
      where: eq(saleSuggestions.id, data.id),
      with: { client: { columns: { organizationId: true, ownerUserId: true } } },
    });
    if (!row || !canAccessClient({ organizationId, role, userId }, row.client)) {
      throw new Error("Sugestão não encontrada.");
    }
    await db.update(saleSuggestions).set({ status: "dismissed" }).where(eq(saleSuggestions.id, data.id));
  });

export async function dismissSaleSuggestion(id: string): Promise<void> {
  await _dismissSaleSuggestion({ data: { id } });
}
