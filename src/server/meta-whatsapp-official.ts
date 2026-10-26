// Conecta o WABA (WhatsApp Business Account) oficial da Meta de um cliente —
// caminho alternativo à instância Evolution (ClientFormDialog continua
// salvando whatsapp_instance_id normalmente, sem mudança nenhuma). Aqui só
// grava o WABA id / phone number id e inscreve o app nos webhooks daquele
// WABA (POST /{waba_id}/subscribed_apps) — a Meta então manda uma cópia dos
// eventos de mensagem pra /api/webhooks/meta-whatsapp.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { requireMetaToken, postMetaJson } from "@/lib/meta";

async function assertAccessibleClient(clientId: string): Promise<{ organizationId: string }> {
  const { organizationId, role, userId } = await requireOrgContext();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { organizationId: true, ownerUserId: true },
  });
  if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
  return { organizationId };
}

const _fetchClientMetaWhatsappOfficial = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<{ wabaId: string | null; phoneNumberId: string | null }> => {
    await assertAccessibleClient(data.clientId);
    const row = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { metaWabaId: true, metaPhoneNumberId: true },
    });
    return { wabaId: row?.metaWabaId ?? null, phoneNumberId: row?.metaPhoneNumberId ?? null };
  });

export async function fetchClientMetaWhatsappOfficial(clientId: string): Promise<{ wabaId: string | null; phoneNumberId: string | null }> {
  return _fetchClientMetaWhatsappOfficial({ data: { clientId } });
}

const _saveClientMetaWhatsappOfficial = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), wabaId: z.string().trim().min(1), phoneNumberId: z.string().trim().min(1) }))
  .handler(async ({ data }): Promise<void> => {
    await assertAccessibleClient(data.clientId);

    const token = await requireMetaToken(data.clientId);

    // Inscreve o app nos webhooks desse WABA — exige que o Business Manager
    // dono do WABA já tenha compartilhado acesso com a organização (mesmo
    // Business Manager que já gerencia a conta de anúncio desse cliente).
    try {
      await postMetaJson(`${data.wabaId}/subscribed_apps`, { access_token: token });
    } catch (e) {
      throw new Error(
        `Não consegui inscrever o app nos webhooks desse WABA — confirme se o Business Manager que gerencia esse WhatsApp já compartilhou acesso com a organização. (${e instanceof Error ? e.message : String(e)})`
      );
    }

    await db
      .update(clients)
      .set({ metaWabaId: data.wabaId, metaPhoneNumberId: data.phoneNumberId })
      .where(eq(clients.id, data.clientId));
  });

export async function saveClientMetaWhatsappOfficial(clientId: string, wabaId: string, phoneNumberId: string): Promise<void> {
  await _saveClientMetaWhatsappOfficial({ data: { clientId, wabaId, phoneNumberId } });
}

const _disconnectClientMetaWhatsappOfficial = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    await assertAccessibleClient(data.clientId);
    await db
      .update(clients)
      .set({ metaWabaId: null, metaPhoneNumberId: null })
      .where(eq(clients.id, data.clientId));
    // Não cancela a inscrição do webhook na Meta de propósito — não tem
    // custo deixar inscrito, e des-configurar errado é pior que um webhook
    // órfão (só não acha mais o cliente e ignora o evento, ver
    // meta-whatsapp-webhook.ts).
  });

export async function disconnectClientMetaWhatsappOfficial(clientId: string): Promise<void> {
  await _disconnectClientMetaWhatsappOfficial({ data: { clientId } });
}
