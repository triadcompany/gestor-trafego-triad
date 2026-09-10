import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  clients,
  messageAutomationDestinations,
  messageAutomationMedia,
  messageAutomations,
  whatsappInstances,
} from "@/db/schema";
import { requireOrgContext } from "@/server/session";

// ── Tipos expostos pra UI ────────────────────────────────────────────────────

export interface AutomationDestination {
  kind: "client_group" | "custom";
  remote_jid: string | null;
  name: string;
}

export interface MessageAutomationRow {
  id: string;
  name: string;
  active: boolean;
  content_type: "text" | "report";
  body: string | null;
  client_id: string | null;
  client_name: string | null;
  report_period_days: number;
  recurrence_type: "weekly" | "daily" | "monthly";
  recurrence_days: number[];
  send_hour: number;
  send_minute: number;
  whatsapp_instance_id: string | null;
  last_run_at: string | null;
  media_count: number;
  destinations: AutomationDestination[];
}

// ── Listar ──────────────────────────────────────────────────────────────────

const _fetchMessageAutomations = createServerFn({ method: "GET" }).handler(async (): Promise<MessageAutomationRow[]> => {
  const { organizationId } = await requireOrgContext();
  const rows = await db.query.messageAutomations.findMany({
    where: eq(messageAutomations.organizationId, organizationId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: {
      destinations: true,
      client: { columns: { name: true } },
      media: { columns: { id: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    content_type: r.contentType as "text" | "report",
    body: r.body,
    client_id: r.clientId,
    client_name: r.client?.name ?? null,
    report_period_days: r.reportPeriodDays,
    recurrence_type: r.recurrenceType as "weekly" | "daily" | "monthly",
    recurrence_days: r.recurrenceDays,
    send_hour: r.sendHour,
    send_minute: r.sendMinute,
    whatsapp_instance_id: r.whatsappInstanceId,
    last_run_at: r.lastRunAt,
    media_count: r.media.length,
    destinations: r.destinations.map((d) => ({
      kind: d.kind as "client_group" | "custom",
      remote_jid: d.remoteJid,
      name: d.name,
    })),
  }));
});

export async function fetchMessageAutomations(): Promise<MessageAutomationRow[]> {
  return _fetchMessageAutomations();
}

const _fetchMessageAutomationMedia = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ base64: string; mimetype: string; filename: string }[]> => {
    const { organizationId } = await requireOrgContext();
    await assertAutomationInOrg(data.id, organizationId);
    return db
      .select({
        base64: messageAutomationMedia.base64,
        mimetype: messageAutomationMedia.mimetype,
        filename: messageAutomationMedia.filename,
      })
      .from(messageAutomationMedia)
      .where(eq(messageAutomationMedia.automationId, data.id))
      .orderBy(messageAutomationMedia.sortOrder);
  });

export async function fetchMessageAutomationMedia(id: string): Promise<{ base64: string; mimetype: string; filename: string }[]> {
  return _fetchMessageAutomationMedia({ data: { id } });
}

// ── Criar / editar ──────────────────────────────────────────────────────────

const mediaItemSchema = z.object({ base64: z.string(), mimetype: z.string(), filename: z.string() });

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  contentType: z.enum(["text", "report"]),
  body: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  reportPeriodDays: z.number().int(),
  recurrenceType: z.enum(["weekly", "daily", "monthly"]),
  recurrenceDays: z.array(z.number().int()),
  sendHour: z.number().int().min(0).max(23),
  sendMinute: z.number().int().min(0).max(59),
  whatsappInstanceId: z.string().nullable().optional(),
  destinations: z
    .array(z.object({ kind: z.enum(["client_group", "custom"]), remoteJid: z.string().nullable(), name: z.string() }))
    .min(1),
  media: z.array(mediaItemSchema).default([]),
});

export type UpsertAutomationInput = z.infer<typeof upsertSchema>;

const _upsertMessageAutomation = createServerFn({ method: "POST" })
  .inputValidator(upsertSchema)
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();

    if (data.contentType === "report") {
      if (!data.clientId) throw new Error("Relatório exige um cliente.");
      if (![7, 15, 30].includes(data.reportPeriodDays)) throw new Error("Período do relatório inválido.");
    } else if (!data.body?.trim() && data.media.length === 0) {
      throw new Error("Mensagem de texto precisa de um texto ou pelo menos uma mídia.");
    }
    if (data.recurrenceType === "weekly") {
      if (data.recurrenceDays.length === 0 || data.recurrenceDays.some((d) => d < 1 || d > 7)) {
        throw new Error("Escolha ao menos um dia da semana.");
      }
    } else if (data.recurrenceType === "monthly") {
      if (data.recurrenceDays.length === 0 || data.recurrenceDays.some((d) => d < 1 || d > 28)) {
        throw new Error("Escolha ao menos um dia do mês (1–28).");
      }
    }

    if (data.clientId) {
      const c = await db.query.clients.findFirst({ where: eq(clients.id, data.clientId), columns: { organizationId: true } });
      if (!c || c.organizationId !== organizationId) throw new Error("Cliente não encontrado.");
    }
    if (data.whatsappInstanceId) {
      const inst = await db.query.whatsappInstances.findFirst({
        where: eq(whatsappInstances.id, data.whatsappInstanceId),
        columns: { organizationId: true },
      });
      if (!inst || inst.organizationId !== organizationId) throw new Error("Instância de WhatsApp não encontrada.");
    }

    const values = {
      organizationId,
      name: data.name,
      contentType: data.contentType,
      body: data.contentType === "text" ? (data.body ?? null) : null,
      clientId: data.clientId ?? null,
      reportPeriodDays: data.reportPeriodDays,
      recurrenceType: data.recurrenceType,
      recurrenceDays: data.recurrenceType === "daily" ? [] : data.recurrenceDays,
      sendHour: data.sendHour,
      sendMinute: data.sendMinute,
      whatsappInstanceId: data.whatsappInstanceId ?? null,
    };

    const automationId = await db.transaction(async (tx) => {
      let id = data.id;
      if (id) {
        const existing = await tx.query.messageAutomations.findFirst({
          where: eq(messageAutomations.id, id),
          columns: { organizationId: true },
        });
        if (!existing || existing.organizationId !== organizationId) throw new Error("Automação não encontrada.");
        await tx.update(messageAutomations).set(values).where(eq(messageAutomations.id, id));
        await tx.delete(messageAutomationDestinations).where(eq(messageAutomationDestinations.automationId, id));
        await tx.delete(messageAutomationMedia).where(eq(messageAutomationMedia.automationId, id));
      } else {
        const [row] = await tx.insert(messageAutomations).values(values).returning({ id: messageAutomations.id });
        id = row.id;
      }
      await tx.insert(messageAutomationDestinations).values(
        data.destinations.map((d) => ({
          automationId: id!,
          kind: d.kind,
          remoteJid: d.kind === "client_group" ? null : d.remoteJid,
          name: d.name,
        }))
      );
      if (data.media.length > 0) {
        await tx.insert(messageAutomationMedia).values(
          data.media.map((m, i) => ({
            automationId: id!,
            base64: m.base64,
            mimetype: m.mimetype,
            filename: m.filename,
            sortOrder: i,
          }))
        );
      }
      return id!;
    });

    return { id: automationId };
  });

export async function upsertMessageAutomation(data: UpsertAutomationInput): Promise<{ id: string }> {
  return _upsertMessageAutomation({ data });
}

// ── Excluir / pausar / rodar agora ──────────────────────────────────────────

async function assertAutomationInOrg(id: string, organizationId: string): Promise<void> {
  const row = await db.query.messageAutomations.findFirst({
    where: eq(messageAutomations.id, id),
    columns: { organizationId: true },
  });
  if (!row || row.organizationId !== organizationId) throw new Error("Automação não encontrada.");
}

const _deleteMessageAutomation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await assertAutomationInOrg(data.id, organizationId);
    await db.delete(messageAutomations).where(eq(messageAutomations.id, data.id));
  });

export async function deleteMessageAutomation(id: string): Promise<void> {
  await _deleteMessageAutomation({ data: { id } });
}

const _toggleMessageAutomation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await assertAutomationInOrg(data.id, organizationId);
    await db.update(messageAutomations).set({ active: data.active }).where(eq(messageAutomations.id, data.id));
  });

export async function toggleMessageAutomation(id: string, active: boolean): Promise<void> {
  await _toggleMessageAutomation({ data: { id, active } });
}

// "Rodar agora" — materializa a regra imediatamente, ignorando o horário.
const _runMessageAutomationNow = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ created: boolean; warnings: string[] }> => {
    const { organizationId } = await requireOrgContext();
    await assertAutomationInOrg(data.id, organizationId);
    const { materializeAndStamp } = await import("@/server/automations-core");
    return materializeAndStamp(data.id);
  });

export async function runMessageAutomationNow(id: string): Promise<{ created: boolean; warnings: string[] }> {
  return _runMessageAutomationNow({ data: { id } });
}
