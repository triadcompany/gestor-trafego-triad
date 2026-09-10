// Módulo SERVER-ONLY — nunca importado por código de cliente (só pelo route
// handler do tick e via import() dinâmico dentro de handlers). Concentra toda a
// lógica que toca o banco fora de um createServerFn: escolha de token/instância
// sem sessão, materialização de regra em mensagem agendada, e o tick.
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  messageAutomations,
  metaTokens,
  scheduledMessageMedia,
  scheduledMessageRecipients,
  scheduledMessages,
  whatsappInstances,
} from "@/db/schema";
import { buildMetricsReportText } from "@/lib/meta";

// ── Escolha de token / instância (sem sessão) ────────────────────────────────

async function pickMetaTokenRow(opts: {
  organizationId: string;
  clientId?: string | null;
}): Promise<{ accessToken: string; expiresAt: string | null } | null> {
  if (opts.clientId) {
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, opts.clientId),
      columns: { organizationId: true, metaTokenId: true },
    });
    if (!client || client.organizationId !== opts.organizationId) return null;
    if (client.metaTokenId) {
      const row = await db.query.metaTokens.findFirst({ where: eq(metaTokens.id, client.metaTokenId) });
      if (row?.active) return row;
    }
  }
  const candidates = await db
    .select()
    .from(metaTokens)
    .where(and(eq(metaTokens.organizationId, opts.organizationId), eq(metaTokens.active, true)))
    .orderBy(metaTokens.createdAt);
  return candidates[0] ?? null;
}

interface PickedInstance {
  instanceId: string;
  url: string;
  apiKey: string;
  instance: string;
}

async function pickWhatsappInstance(opts: {
  organizationId: string;
  clientId?: string | null;
  explicitInstanceId?: string | null;
}): Promise<PickedInstance | null> {
  const shape = (row: typeof whatsappInstances.$inferSelect): PickedInstance => ({
    instanceId: row.id,
    url: row.evolutionUrl,
    apiKey: row.evolutionKey,
    instance: row.instanceName,
  });

  if (opts.explicitInstanceId) {
    const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, opts.explicitInstanceId) });
    if (row?.active && row.organizationId === opts.organizationId) return shape(row);
  }
  if (opts.clientId) {
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, opts.clientId),
      columns: { organizationId: true, whatsappInstanceId: true },
    });
    if (client && client.organizationId === opts.organizationId && client.whatsappInstanceId) {
      const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, client.whatsappInstanceId) });
      if (row?.active) return shape(row);
    }
  }
  const candidates = await db
    .select()
    .from(whatsappInstances)
    .where(and(eq(whatsappInstances.organizationId, opts.organizationId), eq(whatsappInstances.active, true)))
    .orderBy(whatsappInstances.createdAt);
  return candidates[0] ? shape(candidates[0]) : null;
}

// ── Recorrência ─────────────────────────────────────────────────────────────

const SP_TZ = "America/Sao_Paulo";
const WEEKDAY_TO_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function nowInSaoPaulo(base = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SP_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    })
      .formatToParts(base)
      .map((p) => [p.type, p.value])
  );
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    isoDow: WEEKDAY_TO_ISO[parts.weekday as string],
  };
}

// Instante UTC de "hoje (SP) às HH:MM". Brasil sem horário de verão desde 2019 → offset fixo -03:00.
function occurrenceInstant(sp: { year: number; month: number; day: number }, hour: number, minute: number): Date {
  const p = (n: number) => String(n).padStart(2, "0");
  return new Date(`${sp.year}-${p(sp.month)}-${p(sp.day)}T${p(hour)}:${p(minute)}:00-03:00`);
}

type AutomationRuleRow = typeof messageAutomations.$inferSelect;

export function ruleDueNow(rule: AutomationRuleRow, base = new Date()): boolean {
  const sp = nowInSaoPaulo(base);
  const occ = occurrenceInstant(sp, rule.sendHour, rule.sendMinute);
  if (base < occ) return false;
  if (rule.recurrenceType === "weekly" && !rule.recurrenceDays.includes(sp.isoDow)) return false;
  if (rule.recurrenceType === "monthly" && !rule.recurrenceDays.includes(sp.day)) return false;
  if (rule.lastRunAt && new Date(rule.lastRunAt) >= occ) return false;
  return true;
}

// ── Materialização ──────────────────────────────────────────────────────────

export interface MaterializeResult {
  created: boolean;
  warnings: string[];
}

// Cria uma linha em scheduled_messages (pending, envio imediato) a partir da
// regra. created=false (+ warnings) quando não dá pra montar — o chamador então
// NÃO seta last_run_at, pra retentar no próximo tick.
export async function materializeAutomation(ruleId: string): Promise<MaterializeResult> {
  const warnings: string[] = [];

  const rule = await db.query.messageAutomations.findFirst({
    where: eq(messageAutomations.id, ruleId),
    with: { destinations: true, media: { columns: { base64: true, mimetype: true, filename: true, sortOrder: true } } },
  });
  if (!rule) return { created: false, warnings: [`Regra ${ruleId} não encontrada.`] };

  const client = rule.clientId
    ? await db.query.clients.findFirst({
        where: eq(clients.id, rule.clientId),
        columns: { id: true, name: true, metaAdAccountId: true, whatsappGroupId: true },
      })
    : null;

  // 1. Texto
  let text: string;
  if (rule.contentType === "report") {
    if (!client) return { created: false, warnings: [`Regra "${rule.name}": cliente não encontrado.`] };
    const tokenRow = await pickMetaTokenRow({ organizationId: rule.organizationId, clientId: client.id });
    if (!tokenRow) return { created: false, warnings: [`Regra "${rule.name}": nenhum token Meta ativo pra esse cliente.`] };
    if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) {
      return { created: false, warnings: [`Regra "${rule.name}": token Meta expirado.`] };
    }
    try {
      text = await buildMetricsReportText({ metaAdAccountId: client.metaAdAccountId }, rule.reportPeriodDays, tokenRow.accessToken);
    } catch (e) {
      return { created: false, warnings: [`Regra "${rule.name}": falha ao gerar relatório — ${e instanceof Error ? e.message : String(e)}`] };
    }
  } else {
    text = rule.body ?? "";
    if (!text.trim() && rule.media.length === 0) {
      return { created: false, warnings: [`Regra "${rule.name}": sem texto nem mídia.`] };
    }
  }

  // 2. Instância
  const instance = await pickWhatsappInstance({
    organizationId: rule.organizationId,
    clientId: rule.clientId,
    explicitInstanceId: rule.whatsappInstanceId,
  });
  if (!instance) return { created: false, warnings: [`Regra "${rule.name}": nenhuma instância de WhatsApp ativa na organização.`] };

  // 3. Destinos
  const recipients: { remoteJid: string; name: string }[] = [];
  for (const dest of rule.destinations) {
    if (dest.kind === "client_group") {
      if (client?.whatsappGroupId) {
        recipients.push({ remoteJid: client.whatsappGroupId, name: dest.name || "Grupo do cliente" });
      } else {
        warnings.push(`Regra "${rule.name}": destino "grupo do cliente" pulado — cliente sem grupo configurado.`);
      }
    } else if (dest.remoteJid) {
      recipients.push({ remoteJid: dest.remoteJid, name: dest.name });
    }
  }
  if (recipients.length === 0) {
    warnings.push(`Regra "${rule.name}": nenhum destino resolvível — nada enviado.`);
    return { created: false, warnings };
  }

  // 4. Cria a mensagem agendada + destinatários + cópias de mídia
  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(scheduledMessages)
      .values({
        organizationId: rule.organizationId,
        whatsappInstanceId: instance.instanceId,
        body: text,
        scheduledAt: new Date().toISOString(),
        status: "pending",
      })
      .returning();
    await tx.insert(scheduledMessageRecipients).values(
      recipients.map((r) => ({ messageId: msg.id, remoteJid: r.remoteJid, name: r.name, status: "pending" as const }))
    );
    if (rule.media.length > 0) {
      await tx.insert(scheduledMessageMedia).values(
        [...rule.media]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((m, i) => ({ messageId: msg.id, base64: m.base64, mimetype: m.mimetype, filename: m.filename, sortOrder: i }))
      );
    }
  });

  return { created: true, warnings };
}

export async function materializeAndStamp(ruleId: string): Promise<MaterializeResult> {
  const r = await materializeAutomation(ruleId);
  if (r.created) {
    await db.update(messageAutomations).set({ lastRunAt: new Date().toISOString() }).where(eq(messageAutomations.id, ruleId));
  }
  return r;
}

// ── Tick ────────────────────────────────────────────────────────────────────

export interface TickResult {
  rulesChecked: number;
  rulesFired: number;
  messagesCreated: number;
  warnings: string[];
}

export async function runAutomationsTick(): Promise<TickResult> {
  const rules = await db.select().from(messageAutomations).where(eq(messageAutomations.active, true));
  const result: TickResult = { rulesChecked: rules.length, rulesFired: 0, messagesCreated: 0, warnings: [] };

  for (const rule of rules) {
    if (!ruleDueNow(rule)) continue;
    result.rulesFired++;
    try {
      const r = await materializeAndStamp(rule.id);
      result.warnings.push(...r.warnings);
      if (r.created) result.messagesCreated++;
    } catch (e) {
      result.warnings.push(`Regra "${rule.name}": erro inesperado — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
