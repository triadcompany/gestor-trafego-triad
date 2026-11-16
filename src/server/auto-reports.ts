// Relatório automático por cliente: no dia do relatório do cliente (cadastro,
// "Dia do relatório mensal") o tick de automações gera o PDF e manda pro grupo
// operacional ou pro grupo do cliente. Aqui ficam só a configuração (qual
// cliente, qual destino) e as telas de leitura/escrita; quem gera e envia é
// runAutoClientReports em automations-core.ts.
// A config fica em app_config (uma linha por organização), sem tabela nova.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appConfig, clients } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { isTriadCompanyOrg } from "@/lib/feature-flags";

export const AUTO_REPORT_KEY = "auto_report_clients";

export type AutoReportDestination = "operacional" | "client_group";
export interface AutoReportClientConfig {
  enabled: boolean;
  destination: AutoReportDestination;
}
export type AutoReportConfig = Record<string, AutoReportClientConfig>;

export function parseAutoReportConfig(raw: string | null | undefined): AutoReportConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as AutoReportConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const _fetchAutoReportConfig = createServerFn({ method: "GET" }).handler(async (): Promise<AutoReportConfig> => {
  const { organizationId } = await requireOrgContext();
  const rows = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, AUTO_REPORT_KEY)))
    .limit(1);
  return parseAutoReportConfig(rows[0]?.value);
});

export async function fetchAutoReportConfig(): Promise<AutoReportConfig> {
  return _fetchAutoReportConfig();
}

const _setAutoReportClient = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), enabled: z.boolean(), destination: z.enum(["operacional", "client_group"]) }))
  .handler(async ({ data }): Promise<AutoReportConfig> => {
    const { organizationId, role, userId } = await requireOrgContext();
    // Envio automático pra grupos ainda é experimental: só a organização Triad Company.
    if (!isTriadCompanyOrg(organizationId)) throw new Error("O relatório automático ainda não está liberado pra essa organização.");
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, ownerUserId: true, whatsappGroupId: true, monthlyReportDay: true, name: true },
    });
    if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
    if (data.enabled && client.monthlyReportDay === null) {
      throw new Error(`${client.name} não tem dia do relatório configurado. Defina o dia antes de ativar.`);
    }
    if (data.enabled && data.destination === "client_group" && !client.whatsappGroupId) {
      throw new Error(`${client.name} não tem grupo de WhatsApp configurado. Escolha o grupo operacional ou configure o grupo do cliente.`);
    }

    const rows = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, AUTO_REPORT_KEY)))
      .limit(1);
    const config = parseAutoReportConfig(rows[0]?.value);
    config[data.clientId] = { enabled: data.enabled, destination: data.destination };
    await db
      .insert(appConfig)
      .values({ organizationId, key: AUTO_REPORT_KEY, value: JSON.stringify(config) })
      .onConflictDoUpdate({ target: [appConfig.organizationId, appConfig.key], set: { value: JSON.stringify(config) } });
    return config;
  });

export async function setAutoReportClient(clientId: string, enabled: boolean, destination: AutoReportDestination): Promise<AutoReportConfig> {
  return _setAutoReportClient({ data: { clientId, enabled, destination } });
}
