// Módulo SERVER-ONLY — nunca importado por código de cliente (só pelo route
// handler do tick e via import() dinâmico dentro de handlers). Concentra toda a
// lógica que toca o banco fora de um createServerFn: escolha de token/instância
// sem sessão, materialização de regra em mensagem agendada, e o tick.
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  messageAutomations,
  metaTokens,
  organizations,
  reportTemplates,
  saleSuggestions,
  scheduledMessageMedia,
  scheduledMessageRecipients,
  scheduledMessages,
  whatsappInstances,
} from "@/db/schema";
import { buildMetricsReportText, fetchCampaigns } from "@/lib/meta";
import { buildClientReportDoc, slug as slugifyName } from "@/lib/client-report-pdf";

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

// ── Resumo de grupo ─────────────────────────────────────────────────────────
// Portado do workflow n8n "Resumidor de Grupo": lê as mensagens dos grupos dos
// clientes selecionados na janela do turno e classifica por palavra-chave.

const SUMMARY_RULES: { tipo: string; emoji: string; label: string; keywords: string[] }[] = [
  { tipo: "venda", emoji: "🟢", label: "Venda", keywords: ["vendi", "vendeu", "fechou", "fechei"] },
  { tipo: "pausar_veiculo", emoji: "⏸️", label: "Pausar veículo", keywords: ["pausa", "pausar", "pausado", "retirar", "tirar do ar"] },
  { tipo: "crm", emoji: "🎯", label: "CRM", keywords: ["crm", "kommo", "follow-up", "followup", "lead parado", "leads parados"] },
  { tipo: "marketing", emoji: "📄", label: "Marketing", keywords: ["criativo", "vídeo", "video", "foto", "arte", "marketing"] },
  { tipo: "trafego", emoji: "📈", label: "Tráfego", keywords: ["verba", "orçamento", "orcamento", "budget", "tráfego", "trafego", "performance", "aumentar campanha", "aumentar a verba"] },
];

function classifySummary(textLower: string) {
  return SUMMARY_RULES.filter((r) => r.keywords.some((kw) => textLower.includes(kw)));
}

// [inícioSeg, fimSeg) em epoch — janela do turno pra HOJE em BRT (UTC-3).
function summaryWindow(turno: string): { since: number; until: number; label: string; emoji: string } {
  const sp = nowInSaoPaulo();
  const utc = (h: number, min = 0) => Math.floor(Date.UTC(sp.year, sp.month - 1, sp.day, h + 3, min, 0) / 1000);
  if (turno === "tarde") {
    return { since: utc(12), until: utc(17, 30), label: "tarde", emoji: "🌆" };
  }
  return { since: utc(0), until: utc(12), label: "manhã", emoji: "🌞" };
}

interface SummaryInstance {
  url: string;
  apiKey: string;
  instance: string;
}

async function buildGroupSummaryText(
  rule: typeof messageAutomations.$inferSelect,
  instance: SummaryInstance
): Promise<string> {
  const { since, until, label, emoji } = summaryWindow(rule.summaryTurno ?? "manha");

  const rows = await db
    .select({ id: clients.id, name: clients.name, groupId: clients.whatsappGroupId })
    .from(clients)
    .where(eq(clients.organizationId, rule.organizationId));
  const selected = rows.filter((c) => rule.summaryClientIds.includes(c.id));
  const comGrupo = selected.filter((c) => c.groupId);
  const semGrupo = selected.filter((c) => !c.groupId).map((c) => c.name);

  const blocks: string[] = [];
  const semNovidade: string[] = [];

  for (const c of comGrupo) {
    let records: Array<{ key?: { fromMe?: boolean }; messageTimestamp?: number; message?: Record<string, unknown> }> = [];
    try {
      const res = await fetch(`${instance.url.replace(/\/+$/, "")}/chat/findMessages/${encodeURIComponent(instance.instance)}`, {
        method: "POST",
        headers: { apikey: instance.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ where: { key: { remoteJid: c.groupId } }, limit: 200 }),
      });
      const json = (await res.json()) as { messages?: { records?: typeof records } };
      records = json?.messages?.records ?? [];
    } catch {
      blocks.push(`*${c.name}*\n_Erro ao ler o grupo_`);
      continue;
    }

    const mensagens = records
      .filter((r) => r.key?.fromMe === false)
      .filter((r) => typeof r.messageTimestamp === "number" && r.messageTimestamp >= since && r.messageTimestamp < until)
      .map((r) => {
        const msg = (r.message ?? {}) as { conversation?: string; extendedTextMessage?: { text?: string } };
        return (msg.conversation || msg.extendedTextMessage?.text || "").trim();
      })
      .filter((t) => t.length > 0);

    const categorias = new Map<string, { emoji: string; label: string; resumo: string }>();
    for (const m of mensagens) {
      for (const rc of classifySummary(m.toLowerCase())) {
        if (!categorias.has(rc.tipo)) categorias.set(rc.tipo, { emoji: rc.emoji, label: rc.label, resumo: m.slice(0, 140) });
      }
    }
    const semCategoria = mensagens.filter((m) => classifySummary(m.toLowerCase()).length === 0);
    const pedido = semCategoria.find((m) => {
      const l = m.toLowerCase();
      return l.includes("?") || l.startsWith("pode ") || l.startsWith("preciso") || l.startsWith("por favor");
    });
    if (pedido) categorias.set("pedido", { emoji: "📌", label: "Pedido/tarefa", resumo: pedido.slice(0, 140) });

    if (categorias.size > 0) {
      const linhas = Array.from(categorias.values()).map((cat) => `${cat.emoji} ${cat.label}: ${cat.resumo}`).join("\n");
      blocks.push(`*${c.name}*\n${linhas}`);
    } else {
      semNovidade.push(c.name);
    }
  }

  for (const nome of semNovidade) blocks.push(`*${nome}*\n_Sem mensagens relevantes_`);

  const sp = nowInSaoPaulo();
  const dataStr = `${String(sp.day).padStart(2, "0")}/${String(sp.month).padStart(2, "0")}`;
  let text = `${emoji} *Resumo da ${label} — ${dataStr}*\n\n${blocks.join("\n\n")}`;
  if (semGrupo.length > 0) text += `\n\n⚠️ Sem grupo vinculado: ${semGrupo.join(", ")}`;
  return text;
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
        columns: { id: true, name: true, metaAdAccountId: true, whatsappGroupId: true, cplMax: true },
      })
    : null;

  // 1. Instância (necessária já pra ler mensagens no caso do resumo de grupo)
  const instance = await pickWhatsappInstance({
    organizationId: rule.organizationId,
    clientId: rule.clientId,
    explicitInstanceId: rule.whatsappInstanceId,
  });
  if (!instance) return { created: false, warnings: [`Regra "${rule.name}": nenhuma instância de WhatsApp ativa na organização.`] };

  // 2. Texto (+ mídia extra gerada na hora, ex.: PDF do relatório)
  let text: string;
  const extraMedia: Array<{ base64: string; mimetype: string; filename: string }> = [];
  if (rule.contentType === "report_pdf") {
    if (!client) return { created: false, warnings: [`Regra "${rule.name}": cliente não encontrado.`] };
    const tokenRow = await pickMetaTokenRow({ organizationId: rule.organizationId, clientId: client.id });
    if (!tokenRow) return { created: false, warnings: [`Regra "${rule.name}": nenhum token Meta ativo pra esse cliente.`] };
    if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) {
      return { created: false, warnings: [`Regra "${rule.name}": token Meta expirado.`] };
    }
    try {
      const until = new Date().toISOString().slice(0, 10);
      const since = new Date(Date.now() - rule.reportPeriodDays * 86400000).toISOString().slice(0, 10);
      const campaigns = await fetchCampaigns(client.metaAdAccountId, tokenRow.accessToken, "today", { since, until });
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, rule.organizationId), columns: { name: true } });
      const doc = buildClientReportDoc({
        clientName: client.name,
        organizationName: org?.name ?? "Gestão de Tráfego",
        since,
        until,
        cplMax: client.cplMax,
        campaigns,
      });
      const base64 = Buffer.from(doc.output("arraybuffer")).toString("base64");
      extraMedia.push({
        base64,
        mimetype: "application/pdf",
        filename: `relatorio-${slugifyName(client.name)}-${since}_a_${until}.pdf`,
      });
      text = rule.body?.trim() || `📊 Relatório de campanhas — últimos ${rule.reportPeriodDays} dias`;
    } catch (e) {
      return { created: false, warnings: [`Regra "${rule.name}": falha ao gerar o PDF — ${e instanceof Error ? e.message : String(e)}`] };
    }
  } else if (rule.contentType === "report") {
    if (!client) return { created: false, warnings: [`Regra "${rule.name}": cliente não encontrado.`] };
    const tokenRow = await pickMetaTokenRow({ organizationId: rule.organizationId, clientId: client.id });
    if (!tokenRow) return { created: false, warnings: [`Regra "${rule.name}": nenhum token Meta ativo pra esse cliente.`] };
    if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) {
      return { created: false, warnings: [`Regra "${rule.name}": token Meta expirado.`] };
    }
    try {
      let templateBody: string | null = null;
      if (rule.reportTemplateId) {
        const tpl = await db.query.reportTemplates.findFirst({
          where: eq(reportTemplates.id, rule.reportTemplateId),
          columns: { body: true },
        });
        templateBody = tpl?.body ?? null;
      } else if (rule.body) {
        templateBody = rule.body;
      }
      text = await buildMetricsReportText({ metaAdAccountId: client.metaAdAccountId, name: client.name }, rule.reportPeriodDays, tokenRow.accessToken, templateBody);
    } catch (e) {
      return { created: false, warnings: [`Regra "${rule.name}": falha ao gerar relatório — ${e instanceof Error ? e.message : String(e)}`] };
    }
  } else if (rule.contentType === "group_summary") {
    if (rule.summaryClientIds.length === 0) {
      return { created: false, warnings: [`Regra "${rule.name}": nenhum cliente selecionado pro resumo.`] };
    }
    try {
      text = await buildGroupSummaryText(rule, instance);
    } catch (e) {
      return { created: false, warnings: [`Regra "${rule.name}": falha ao montar resumo — ${e instanceof Error ? e.message : String(e)}`] };
    }
  } else {
    text = rule.body ?? "";
    if (!text.trim() && rule.media.length === 0) {
      return { created: false, warnings: [`Regra "${rule.name}": sem texto nem mídia.`] };
    }
  }

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
    const mediaToInsert = [
      ...[...rule.media].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => ({ base64: m.base64, mimetype: m.mimetype, filename: m.filename })),
      ...extraMedia,
    ];
    if (mediaToInsert.length > 0) {
      await tx.insert(scheduledMessageMedia).values(
        mediaToInsert.map((m, i) => ({ messageId: msg.id, base64: m.base64, mimetype: m.mimetype, filename: m.filename, sortOrder: i }))
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

// ── Sugestões de venda (varredura de palavra-chave no grupo do WhatsApp) ─────
// Roda pra todas as organizações, sem escopo de sessão — mesmo padrão do
// resto do tick. Nunca cria uma venda: só a sugestão pendente que o gestor
// confirma ou descarta na página Vendas.

type SaleScanRecord = {
  key?: { fromMe?: boolean };
  messageTimestamp?: number;
  message?: { conversation?: string; extendedTextMessage?: { text?: string } };
};

export async function scanClientsForSaleSuggestions(): Promise<number> {
  const rows = await db
    .select({
      id: clients.id,
      organizationId: clients.organizationId,
      groupId: clients.whatsappGroupId,
      lastScanAt: clients.lastSaleScanAt,
    })
    .from(clients)
    .where(and(eq(clients.active, true), isNotNull(clients.whatsappGroupId)));

  let created = 0;

  for (const c of rows) {
    if (!c.groupId) continue;
    const instance = await pickWhatsappInstance({ organizationId: c.organizationId, clientId: c.id });
    if (!instance) continue;

    let records: SaleScanRecord[] = [];
    try {
      const res = await fetch(`${instance.url.replace(/\/+$/, "")}/chat/findMessages/${encodeURIComponent(instance.instance)}`, {
        method: "POST",
        headers: { apikey: instance.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ where: { key: { remoteJid: c.groupId } }, limit: 100 }),
      });
      const json = (await res.json()) as { messages?: { records?: SaleScanRecord[] } };
      records = json?.messages?.records ?? [];
    } catch {
      continue; // erro isolado por cliente — não trava a varredura dos demais
    }

    const lastScanEpoch = c.lastScanAt ? Math.floor(new Date(c.lastScanAt).getTime() / 1000) : null;
    const isFirstScan = lastScanEpoch === null;

    const incoming = records.filter(
      (r): r is SaleScanRecord & { messageTimestamp: number } => r.key?.fromMe === false && typeof r.messageTimestamp === "number"
    );
    if (incoming.length === 0) continue;

    let maxTs = lastScanEpoch ?? 0;
    for (const r of incoming) {
      if (r.messageTimestamp > maxTs) maxTs = r.messageTimestamp;
      // Primeira varredura do cliente: só marca o checkpoint, não sugere
      // venda retroativa a partir do histórico inteiro do grupo.
      if (isFirstScan || r.messageTimestamp <= (lastScanEpoch ?? 0)) continue;

      const text = (r.message?.conversation || r.message?.extendedTextMessage?.text || "").trim();
      if (!text) continue;
      if (!classifySummary(text.toLowerCase()).some((cat) => cat.tipo === "venda")) continue;

      try {
        const [inserted] = await db
          .insert(saleSuggestions)
          .values({
            clientId: c.id,
            messageText: text.slice(0, 300),
            messageAt: new Date(r.messageTimestamp * 1000).toISOString(),
          })
          .onConflictDoNothing({ target: [saleSuggestions.clientId, saleSuggestions.messageAt, saleSuggestions.messageText] })
          .returning({ id: saleSuggestions.id });
        if (inserted) created++;
      } catch {
        // segue tentando as próximas mensagens desse cliente
      }
    }

    if (maxTs > (lastScanEpoch ?? 0)) {
      await db.update(clients).set({ lastSaleScanAt: new Date(maxTs * 1000).toISOString() }).where(eq(clients.id, c.id));
    }
  }

  return created;
}

// ── Tick ────────────────────────────────────────────────────────────────────

export interface TickResult {
  rulesChecked: number;
  rulesFired: number;
  messagesCreated: number;
  saleSuggestionsCreated: number;
  warnings: string[];
}

export async function runAutomationsTick(): Promise<TickResult> {
  const rules = await db.select().from(messageAutomations).where(eq(messageAutomations.active, true));
  const result: TickResult = { rulesChecked: rules.length, rulesFired: 0, messagesCreated: 0, saleSuggestionsCreated: 0, warnings: [] };

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

  try {
    result.saleSuggestionsCreated = await scanClientsForSaleSuggestions();
  } catch (e) {
    result.warnings.push(`Varredura de sugestões de venda: erro inesperado — ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
