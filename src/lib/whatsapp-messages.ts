import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/db/client";
import { appConfig, clients, scheduledMessageMedia, scheduledMessageRecipients, scheduledMessages, whatsappInstances } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { resolvePublicClientId } from "@/server/lead-attribution";

const mediaItemSchema = z.object({
  base64: z.string(),
  mimetype: z.string(),
  filename: z.string(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

// Duas instâncias de propósitos DIFERENTES, que não podem se confundir:
//
// - Instância do GESTOR: usada por toda automação/mensagem interna do sistema
//   (mensagens agendadas, busca de destinatários, lista de campanhas, relatório
//   semanal quando o destino é o grupo operacional). Nunca depende de qual
//   cliente está sendo visto na tela.
// - Instância do CLIENTE: usada só pro rastreamento de leads (o número que
//   recebe os cliques de anúncio Click-to-WhatsApp daquele cliente específico)
//   e para mandar mensagem no grupo/número do PRÓPRIO cliente.
//
// Misturar as duas já causou bug real: uma automação/relatório saindo pela
// instância do cliente (que não é membro do grupo interno da equipe) em vez
// da instância do gestor — a mensagem "enviava com sucesso" mas nunca chegava
// em lugar nenhum. Por isso duas funções com nomes que deixam a intenção
// óbvia em cada lugar que usa, em vez de um parâmetro opcional ambíguo.
//
// Envolvida em createServerFn (como tudo mais neste arquivo) pra garantir que o
// código que toca o Postgres nunca vaze pro bundle do navegador — este módulo é
// importado por componentes de cliente (ex: ClientFormDialog), então qualquer
// função solta aqui que use `db` diretamente entraria no bundle do cliente.
export interface ResolvedWhatsappInstance {
  instanceId: string;
  url: string;
  apiKey: string;
  instance: string;
  operationalGroupId: string | null;
}

const _resolveWhatsappInstance = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string().optional() }))
  .handler(async ({ data }): Promise<ResolvedWhatsappInstance> => {
    const { organizationId, userId, role } = await requireOrgContext();

    if (data.clientId) {
      const client = await db.query.clients.findFirst({
        where: eq(clients.id, data.clientId),
        columns: { organizationId: true, ownerUserId: true, whatsappInstanceId: true },
      });
      if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
      if (client.whatsappInstanceId) {
        const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, client.whatsappInstanceId) });
        if (row?.active) {
          return { instanceId: row.id, url: row.evolutionUrl, apiKey: row.evolutionKey, instance: row.instanceName, operationalGroupId: row.operationalGroupId };
        }
      }
    }

    // Fallback (sem cliente, ou cliente sem instância própria): só instância
    // "do gestor" — nunca a de OUTRO cliente qualquer. Mesmo bug de antes (ver
    // comentário acima) também acontecia aqui: "Enviar lista de campanhas" e o
    // relatório semanal chamam isso sem clientId, e sem esse filtro podiam cair
    // na instância de rastreamento de um cliente qualquer (mensagem "enviada"
    // mas nunca chegava em lugar nenhum, porque essa instância não é membro do
    // grupo operacional).
    const rows = await db
      .select({ instance: whatsappInstances })
      .from(whatsappInstances)
      .leftJoin(clients, eq(clients.whatsappInstanceId, whatsappInstances.id))
      .where(and(eq(whatsappInstances.organizationId, organizationId), eq(whatsappInstances.active, true), isNull(clients.id)))
      .orderBy(desc(whatsappInstances.isDefaultGestor), whatsappInstances.createdAt);
    const candidates = rows.map((r) => r.instance);
    const chosen = candidates.find((i) => i.assignedUserId === userId) ?? candidates[0];
    if (!chosen) throw new Error("Nenhuma instância de WhatsApp do gestor configurada. Acesse Configurações.");
    return { instanceId: chosen.id, url: chosen.evolutionUrl, apiKey: chosen.evolutionKey, instance: chosen.instanceName, operationalGroupId: chosen.operationalGroupId };
  });

/** Instância do GESTOR (padrão da organização, ou a atribuída ao usuário logado) — pra automação/mensagem interna. Nunca usa a instância própria de um cliente. */
export async function resolveGestorWhatsappInstance(): Promise<ResolvedWhatsappInstance> {
  return _resolveWhatsappInstance({ data: {} });
}

/** Instância do CLIENTE — pra rastreamento de leads e mensagens no grupo/número do próprio cliente. Cai pra instância do gestor só se o cliente não tiver uma própria configurada. */
export async function resolveClientWhatsappInstance(clientId: string): Promise<ResolvedWhatsappInstance> {
  return _resolveWhatsappInstance({ data: { clientId } });
}

// Resolve uma instância ESPECÍFICA pelo id (não "a do gestor logado" nem "a do
// cliente") — usado em telas de administração, como buscar os grupos que uma
// instância em particular enxerga (editar o grupo operacional dela) mesmo que
// não seja a instância padrão nem a do usuário atual.
const _resolveWhatsappInstanceById = createServerFn({ method: "GET" })
  .inputValidator(z.object({ instanceId: z.string() }))
  .handler(async ({ data }): Promise<ResolvedWhatsappInstance> => {
    const { organizationId } = await requireOrgContext();
    const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, data.instanceId) });
    if (!row || row.organizationId !== organizationId) throw new Error("Instância não encontrada.");
    return { instanceId: row.id, url: row.evolutionUrl, apiKey: row.evolutionKey, instance: row.instanceName, operationalGroupId: row.operationalGroupId };
  });

export async function resolveWhatsappInstanceById(instanceId: string): Promise<ResolvedWhatsappInstance> {
  return _resolveWhatsappInstanceById({ data: { instanceId } });
}

// Grupo "Operacional" pra uma instância já resolvida — o próprio da instância
// (um por gestor) se tiver sido configurado; senão cai no valor antigo único
// em app_config (organizações/instâncias que ainda não migraram pro grupo por
// gestor). Compartilhado entre os envios manuais (lista de campanhas,
// relatório semanal) pra não duplicar esse fallback em cada um.
// createServerOnlyFn (não createServerFn): chamada só de dentro de outro
// handler de servidor (nunca via RPC direto do navegador) — este módulo
// também é importado por componentes de cliente (ex: ClientFormDialog),
// então uma função solta usando `db` aqui vazaria o driver do Postgres pro
// bundle do navegador.
export const resolveOperationalGroupId = createServerOnlyFn(async function resolveOperationalGroupId(
  resolved: ResolvedWhatsappInstance,
  organizationId: string
): Promise<string | null> {
  if (resolved.operationalGroupId) return resolved.operationalGroupId;
  const legacy = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, "whatsapp_group_operacional_id")));
  return legacy[0]?.value ?? null;
});

// ── Instâncias WhatsApp ────────────────────────────────────────────
// Todas as organizações usam o MESMO servidor Evolution (env EVOLUTION_API_URL /
// EVOLUTION_API_KEY, com fallback pros valores atuais). Cada usuário gera a
// própria instância dentro dele; o app cria na Evolution, mostra o QR e guarda a
// linha em whatsapp_instances com a chave própria daquela instância.

const EVOLUTION_URL = () => (process.env.EVOLUTION_API_URL || "https://triadcompany-evolution-api.upw28y.easypanel.host").replace(/\/+$/, "");
const EVOLUTION_ADMIN_KEY = () => process.env.EVOLUTION_API_KEY || "429683C4C977415CAAFCCE10F7D57E11";
const APP_URL = () => (process.env.APP_URL || "https://gestor.triadcomp4ny.com.br").replace(/\/+$/, "");

// Liga o webhook da instância recém-criada no rastreamento de leads (ver
// evolution-webhook.route.ts). Sem isso, a Evolution API nunca avisa o
// sistema sobre mensagens novas — descoberto manualmente uma vez (instância
// da Gama Veículos criada sem esse passo, zero leads capturados) e daí em
// diante automatizado aqui pra nunca mais precisar configurar isso na mão.
async function configureEvolutionWebhook(instanceName: string, apikey: string): Promise<void> {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return; // sem secret configurado no ambiente, não dá pra montar a URL com segurança
  await evoFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    apikey,
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: `${APP_URL()}/api/webhooks/evolution?secret=${secret}`,
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT", "LABELS_ASSOCIATION"],
      },
    }),
  });
}

async function evoFetch(path: string, init: RequestInit & { apikey?: string } = {}) {
  const { apikey, ...rest } = init;
  const res = await fetch(`${EVOLUTION_URL()}${path}`, {
    ...rest,
    headers: { apikey: apikey || EVOLUTION_ADMIN_KEY(), "Content-Type": "application/json", ...(rest.headers || {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = (json && typeof json === "object" && "message" in json && (json as { message: unknown }).message) || text || res.statusText;
    throw new Error(`Evolution ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

export interface WhatsappInstanceRow {
  id: string;
  label: string;
  instanceName: string;
  assignedUserId: string | null;
  active: boolean;
  createdAt: string;
  clientId: string | null;
  clientName: string | null;
  isDefaultGestor: boolean;
  operationalGroupId: string | null;
  operationalGroupName: string | null;
}

const _fetchWhatsappInstances = createServerFn({ method: "GET" }).handler(async (): Promise<WhatsappInstanceRow[]> => {
  const { organizationId } = await requireOrgContext();
  const rows = await db
    .select({
      id: whatsappInstances.id,
      label: whatsappInstances.label,
      instanceName: whatsappInstances.instanceName,
      assignedUserId: whatsappInstances.assignedUserId,
      active: whatsappInstances.active,
      createdAt: whatsappInstances.createdAt,
      clientId: clients.id,
      clientName: clients.name,
      isDefaultGestor: whatsappInstances.isDefaultGestor,
      operationalGroupId: whatsappInstances.operationalGroupId,
      operationalGroupName: whatsappInstances.operationalGroupName,
    })
    .from(whatsappInstances)
    .leftJoin(clients, eq(clients.whatsappInstanceId, whatsappInstances.id))
    .where(eq(whatsappInstances.organizationId, organizationId))
    .orderBy(whatsappInstances.createdAt);
  // Se mais de um cliente estiver (por engano) apontando pra mesma instância, o
  // join traria uma linha por cliente — dedupe mantendo só a primeira ocorrência.
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
});

export interface ClientWhatsappInfo {
  instanceLabel: string | null;
  connectedAt: string | null;
}

// Não existe um timestamp de "conectou de fato" (a Evolution só expõe o
// estado atual via /instance/connectionState, sem histórico) — usa a criação
// da instância no sistema como aproximação, já que a instância nasce junto
// com o fluxo de conexão (criar -> mostrar QR -> escanear).
const _fetchClientWhatsappInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<ClientWhatsappInfo> => {
    const { organizationId, role, userId } = await requireOrgContext();
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, ownerUserId: true, whatsappInstanceId: true },
    });
    if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
    if (!client.whatsappInstanceId) return { instanceLabel: null, connectedAt: null };

    const instance = await db.query.whatsappInstances.findFirst({
      where: eq(whatsappInstances.id, client.whatsappInstanceId),
      columns: { label: true, createdAt: true },
    });
    return { instanceLabel: instance?.label ?? null, connectedAt: instance?.createdAt ?? null };
  });

export async function fetchClientWhatsappInfo(clientId: string): Promise<ClientWhatsappInfo> {
  return _fetchClientWhatsappInfo({ data: { clientId } });
}

// Mesma coisa, mas resolvendo o cliente pelo token do link público de
// rastreamento (/r/$token) em vez de sessão/organização — o próprio cliente
// (dono do negócio) também deve ver a data de conexão do WhatsApp dele.
const _fetchPublicClientWhatsappInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<ClientWhatsappInfo> => {
    const clientId = await resolvePublicClientId(data.token);
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      columns: { whatsappInstanceId: true },
    });
    if (!client?.whatsappInstanceId) return { instanceLabel: null, connectedAt: null };

    const instance = await db.query.whatsappInstances.findFirst({
      where: eq(whatsappInstances.id, client.whatsappInstanceId),
      columns: { label: true, createdAt: true },
    });
    return { instanceLabel: instance?.label ?? null, connectedAt: instance?.createdAt ?? null };
  });

export async function fetchPublicClientWhatsappInfo(token: string): Promise<ClientWhatsappInfo> {
  return _fetchPublicClientWhatsappInfo({ data: { token } });
}

export async function fetchWhatsappInstances(): Promise<WhatsappInstanceRow[]> {
  return _fetchWhatsappInstances();
}

function sanitizeInstanceName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Cria a instância na Evolution e grava a linha. Retorna o QR code (base64) já
// pronto pra escanear.
const _createWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      label: z.string().min(1),
      instanceName: z.string().min(1),
      assignedUserId: z.string().nullable().optional(),
      clientId: z.string().nullable().optional(),
    })
  )
  .handler(async ({ data }): Promise<{ id: string; qrBase64: string | null }> => {
    const { organizationId, role, userId } = await requireOrgContext();
    const base = sanitizeInstanceName(data.instanceName);
    if (!base) throw new Error("Nome da instância inválido — use letras e números.");

    let client: { organizationId: string; ownerUserId: string | null } | undefined;
    if (data.clientId) {
      client = await db.query.clients.findFirst({
        where: eq(clients.id, data.clientId),
        columns: { organizationId: true, ownerUserId: true },
      });
      if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
    }

    // Sufixo curto da org pra evitar colisão no servidor compartilhado.
    const instanceName = `${base}-${organizationId.slice(0, 4)}`;

    const created = (await evoFetch("/instance/create", {
      method: "POST",
      body: JSON.stringify({ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }),
    })) as {
      hash?: string | { apikey?: string };
      qrcode?: { base64?: string; code?: string };
    };

    const instanceKey =
      typeof created.hash === "string"
        ? created.hash
        : created.hash?.apikey || EVOLUTION_ADMIN_KEY();

    try {
      await configureEvolutionWebhook(instanceName, instanceKey);
    } catch {
      // não deixa falha ao configurar o webhook impedir a criação da instância —
      // melhor ela existir sem rastreamento de leads (corrigível depois) do que
      // travar o fluxo de conexão do WhatsApp por um problema à parte.
    }

    const [row] = await db
      .insert(whatsappInstances)
      .values({
        organizationId,
        label: data.label.trim(),
        evolutionUrl: EVOLUTION_URL(),
        evolutionKey: instanceKey,
        instanceName,
        assignedUserId: data.assignedUserId ?? null,
      })
      .returning({ id: whatsappInstances.id });

    if (data.clientId) {
      await db.update(clients).set({ whatsappInstanceId: row.id }).where(eq(clients.id, data.clientId));
    }

    return { id: row.id, qrBase64: created.qrcode?.base64 ?? null };
  });

export async function createWhatsappInstance(data: {
  label: string;
  instanceName: string;
  assignedUserId?: string | null;
  clientId?: string | null;
}): Promise<{ id: string; qrBase64: string | null }> {
  return _createWhatsappInstance({ data });
}

async function loadInstanceInOrg(id: string, organizationId: string) {
  const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, id) });
  if (!row || row.organizationId !== organizationId) throw new Error("Instância não encontrada.");
  return row;
}

// (Re)pega o QR code de uma instância que ainda não conectou.
const _fetchWhatsappInstanceQr = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ qrBase64: string | null }> => {
    const { organizationId } = await requireOrgContext();
    const inst = await loadInstanceInOrg(data.id, organizationId);
    const r = (await evoFetch(`/instance/connect/${encodeURIComponent(inst.instanceName)}`, {
      method: "GET",
      apikey: inst.evolutionKey,
    })) as { base64?: string; code?: string };
    return { qrBase64: r.base64 ?? null };
  });

export async function fetchWhatsappInstanceQr(id: string): Promise<{ qrBase64: string | null }> {
  return _fetchWhatsappInstanceQr({ data: { id } });
}

// Status de conexão: 'open' (conectado) | 'connecting' | 'close'.
const _fetchWhatsappInstanceState = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ state: "open" | "connecting" | "close" | "unknown" }> => {
    const { organizationId } = await requireOrgContext();
    const inst = await loadInstanceInOrg(data.id, organizationId);
    try {
      const r = (await evoFetch(`/instance/connectionState/${encodeURIComponent(inst.instanceName)}`, {
        method: "GET",
        apikey: inst.evolutionKey,
      })) as { instance?: { state?: string } };
      const s = r.instance?.state;
      return { state: s === "open" || s === "connecting" || s === "close" ? s : "unknown" };
    } catch {
      return { state: "unknown" };
    }
  });

export async function fetchWhatsappInstanceState(id: string): Promise<{ state: "open" | "connecting" | "close" | "unknown" }> {
  return _fetchWhatsappInstanceState({ data: { id } });
}

// Pra alerta global na UI (WhatsappDisconnectedBanner) — checa TODAS as
// instâncias ativas da organização de uma vez (gestor + clientes), igual a
// automação "Instância desconectada" em automations-core.ts (mas essa aqui é
// sob demanda, direto da sessão do navegador, não pelo tick agendado).
const _fetchDisconnectedInstances = createServerFn({ method: "GET" }).handler(async (): Promise<string[]> => {
  const { organizationId } = await requireOrgContext();
  const instances = await db
    .select({ label: whatsappInstances.label, evolutionKey: whatsappInstances.evolutionKey, instanceName: whatsappInstances.instanceName })
    .from(whatsappInstances)
    .where(and(eq(whatsappInstances.organizationId, organizationId), eq(whatsappInstances.active, true)));

  const disconnected: string[] = [];
  await Promise.all(
    instances.map(async (inst) => {
      try {
        const r = (await evoFetch(`/instance/connectionState/${encodeURIComponent(inst.instanceName)}`, {
          method: "GET",
          apikey: inst.evolutionKey,
        })) as { instance?: { state?: string } };
        if (r.instance?.state !== "open") disconnected.push(inst.label);
      } catch {
        // instância sem resposta também conta como "não confirmadamente conectada"
        disconnected.push(inst.label);
      }
    })
  );
  return disconnected;
});

export async function fetchDisconnectedInstances(): Promise<string[]> {
  return _fetchDisconnectedInstances();
}

// Edita só o rótulo e o gestor atribuído (o nome técnico e a chave não mudam).
const _renameWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), label: z.string().min(1), assignedUserId: z.string().nullable().optional() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await loadInstanceInOrg(data.id, organizationId);
    await db
      .update(whatsappInstances)
      .set({ label: data.label.trim(), assignedUserId: data.assignedUserId ?? null })
      .where(eq(whatsappInstances.id, data.id));
  });

export async function renameWhatsappInstance(id: string, label: string, assignedUserId?: string | null): Promise<void> {
  await _renameWhatsappInstance({ data: { id, label, assignedUserId } });
}

// Grupo que essa instância usa pros envios manuais com destino "Operacional"
// (lista de campanhas ativas, relatório semanal) — ver comentário no schema.
const _setInstanceOperationalGroup = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), groupId: z.string().nullable(), groupName: z.string().nullable() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await loadInstanceInOrg(data.id, organizationId);
    await db
      .update(whatsappInstances)
      .set({ operationalGroupId: data.groupId, operationalGroupName: data.groupName })
      .where(eq(whatsappInstances.id, data.id));
  });

export async function setInstanceOperationalGroup(id: string, groupId: string | null, groupName: string | null): Promise<void> {
  await _setInstanceOperationalGroup({ data: { id, groupId, groupName } });
}

// Troca qual cliente está vinculado a essa instância (usado pelo rastreamento de
// leads). Sempre desvincula qualquer outro cliente que já apontasse pra ela
// primeiro — uma instância só pode pertencer a um cliente por vez (uma
// instância compartilhada entre vários já causou atribuição errada de leads).
const _setInstanceClient = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), clientId: z.string().nullable() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await loadInstanceInOrg(data.id, organizationId);

    await db.update(clients).set({ whatsappInstanceId: null }).where(eq(clients.whatsappInstanceId, data.id));

    if (data.clientId) {
      const client = await db.query.clients.findFirst({
        where: eq(clients.id, data.clientId),
        columns: { organizationId: true },
      });
      if (!client || client.organizationId !== organizationId) throw new Error("Cliente não encontrado.");
      await db.update(clients).set({ whatsappInstanceId: data.id }).where(eq(clients.id, data.clientId));
    }
  });

export async function setInstanceClient(id: string, clientId: string | null): Promise<void> {
  await _setInstanceClient({ data: { id, clientId } });
}

// Marca qual instância é "a" instância oficial do gestor pra automação — no
// máximo uma por organização, então desmarca qualquer outra primeiro. Usada
// como prioridade no fallback automático (pickGestorWhatsappInstance em
// automations-core.ts) quando a regra não tem instância explícita escolhida.
const _setDefaultGestorInstance = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await loadInstanceInOrg(data.id, organizationId);
    await db.transaction(async (tx) => {
      await tx.update(whatsappInstances).set({ isDefaultGestor: false }).where(eq(whatsappInstances.organizationId, organizationId));
      await tx.update(whatsappInstances).set({ isDefaultGestor: true }).where(eq(whatsappInstances.id, data.id));
    });
  });

export async function setDefaultGestorInstance(id: string): Promise<void> {
  await _setDefaultGestorInstance({ data: { id } });
}

const _deleteWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    const inst = await loadInstanceInOrg(data.id, organizationId);
    // Best-effort: desconecta e apaga na Evolution antes de remover a linha.
    await evoFetch(`/instance/logout/${encodeURIComponent(inst.instanceName)}`, { method: "DELETE", apikey: inst.evolutionKey }).catch(() => {});
    await evoFetch(`/instance/delete/${encodeURIComponent(inst.instanceName)}`, { method: "DELETE", apikey: inst.evolutionKey }).catch(() => {});
    await db.delete(whatsappInstances).where(eq(whatsappInstances.id, data.id));
  });

export async function deleteWhatsappInstance(id: string): Promise<void> {
  await _deleteWhatsappInstance({ data: { id } });
}

// ── Link público de conexão (cliente escaneia sem precisar logar) ──────────

const _generateInstanceConnectLink = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ token: string }> => {
    const { organizationId } = await requireOrgContext();
    await loadInstanceInOrg(data.id, organizationId);
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await db
      .update(whatsappInstances)
      .set({ connectToken: token, connectTokenExpiresAt: expiresAt })
      .where(eq(whatsappInstances.id, data.id));
    return { token };
  });

export async function generateInstanceConnectLink(id: string): Promise<{ token: string }> {
  return _generateInstanceConnectLink({ data: { id } });
}

async function loadInstanceByToken(token: string) {
  const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.connectToken, token) });
  if (!row || (row.connectTokenExpiresAt && new Date(row.connectTokenExpiresAt) < new Date())) {
    throw new Error("Link inválido ou expirado.");
  }
  return row;
}

// Sem requireOrgContext() de propósito — essa dupla (QR + estado) é acessada
// por quem recebeu o link, sem estar logado no sistema. A validação é só o
// token bater e não estar expirado; nunca expõe evolutionKey/instanceName.
const _fetchInstanceQrByToken = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<{ qrBase64: string | null }> => {
    const inst = await loadInstanceByToken(data.token);
    const r = (await evoFetch(`/instance/connect/${encodeURIComponent(inst.instanceName)}`, {
      method: "GET",
      apikey: inst.evolutionKey,
    })) as { base64?: string; code?: string };
    return { qrBase64: r.base64 ?? null };
  });

export async function fetchInstanceQrByToken(token: string): Promise<{ qrBase64: string | null }> {
  return _fetchInstanceQrByToken({ data: { token } });
}

const _fetchInstanceStateByToken = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<{ state: "open" | "connecting" | "close" | "unknown" }> => {
    const inst = await loadInstanceByToken(data.token);
    try {
      const r = (await evoFetch(`/instance/connectionState/${encodeURIComponent(inst.instanceName)}`, {
        method: "GET",
        apikey: inst.evolutionKey,
      })) as { instance?: { state?: string } };
      const s = r.instance?.state;
      const state = s === "open" || s === "connecting" || s === "close" ? s : "unknown";
      if (state === "open") {
        // Link já cumpriu o papel — invalida pra não continuar acessível depois de conectado.
        await db
          .update(whatsappInstances)
          .set({ connectToken: null, connectTokenExpiresAt: null })
          .where(eq(whatsappInstances.id, inst.id));
      }
      return { state };
    } catch {
      return { state: "unknown" };
    }
  });

export async function fetchInstanceStateByToken(token: string): Promise<{ state: "open" | "connecting" | "close" | "unknown" }> {
  return _fetchInstanceStateByToken({ data: { token } });
}

export interface ScheduledMessageRecipientRow {
  id: string;
  remote_jid: string;
  name: string;
  status: "pending" | "sent" | "failed";
  sent_at: string | null;
  error_message: string | null;
}

export interface ScheduledMessageRow {
  id: string;
  body: string;
  media_count: number;
  scheduled_at: string;
  status: "pending" | "sent" | "partial" | "failed" | "canceled";
  created_at: string;
  recipients: ScheduledMessageRecipientRow[];
}

const _fetchScheduledMessages = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId } = await requireOrgContext();
  const messages = await db
    .select({
      id: scheduledMessages.id,
      body: scheduledMessages.body,
      mediaBase64: scheduledMessages.mediaBase64,
      scheduledAt: scheduledMessages.scheduledAt,
      status: scheduledMessages.status,
      createdAt: scheduledMessages.createdAt,
    })
    .from(scheduledMessages)
    .where(eq(scheduledMessages.organizationId, organizationId))
    .orderBy(desc(scheduledMessages.scheduledAt));

  if (messages.length === 0) return [];

  const [recipients, media] = await Promise.all([
    db
      .select()
      .from(scheduledMessageRecipients)
      .where(inArray(scheduledMessageRecipients.messageId, messages.map((m) => m.id))),
    db
      .select({ messageId: scheduledMessageMedia.messageId })
      .from(scheduledMessageMedia)
      .where(inArray(scheduledMessageMedia.messageId, messages.map((m) => m.id))),
  ]);

  return messages.map((m) => {
    const newMediaCount = media.filter((x) => x.messageId === m.id).length;
    return {
      id: m.id,
      body: m.body,
      media_count: newMediaCount > 0 ? newMediaCount : m.mediaBase64 ? 1 : 0,
      scheduled_at: m.scheduledAt,
      status: m.status as ScheduledMessageRow["status"],
      created_at: m.createdAt,
      recipients: recipients
        .filter((r) => r.messageId === m.id)
        .map((r) => ({
          id: r.id,
          remote_jid: r.remoteJid,
          name: r.name,
          status: r.status as ScheduledMessageRecipientRow["status"],
          sent_at: r.sentAt,
          error_message: r.errorMessage,
        })),
    };
  });
});

export async function fetchScheduledMessages(): Promise<ScheduledMessageRow[]> {
  return _fetchScheduledMessages();
}

const _createScheduledMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      body: z.string().min(1),
      media: z.array(mediaItemSchema).default([]),
      scheduledAt: z.string(),
      recipients: z.array(z.object({ remoteJid: z.string(), name: z.string() })).min(1),
      whatsappInstanceId: z.string().optional(),
    })
  )
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    // Resolve a instância agora (mesmo sem usá-la aqui) só pra validar que existe
    // uma configurada antes de agendar — evita criar uma mensagem que nunca vai sair.
    const resolved = data.whatsappInstanceId
      ? await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, data.whatsappInstanceId) })
      : null;
    if (data.whatsappInstanceId && (!resolved || resolved.organizationId !== organizationId)) {
      throw new Error("Instância de WhatsApp não encontrada.");
    }
    const whatsappInstanceId = resolved?.id ?? (await resolveGestorWhatsappInstance()).instanceId;

    await db.transaction(async (tx) => {
      const [message] = await tx
        .insert(scheduledMessages)
        .values({
          organizationId,
          whatsappInstanceId,
          body: data.body,
          scheduledAt: data.scheduledAt,
          status: "pending",
        })
        .returning();
      await tx.insert(scheduledMessageRecipients).values(
        data.recipients.map((r) => ({
          messageId: message.id,
          remoteJid: r.remoteJid,
          name: r.name,
          status: "pending" as const,
        }))
      );
      if (data.media.length > 0) {
        await tx.insert(scheduledMessageMedia).values(
          data.media.map((m, i) => ({
            messageId: message.id,
            base64: m.base64,
            mimetype: m.mimetype,
            filename: m.filename,
            sortOrder: i,
          }))
        );
      }
    });
  });

export async function createScheduledMessage(data: {
  body: string;
  media?: MediaItem[];
  scheduledAt: string;
  recipients: { remoteJid: string; name: string }[];
  whatsappInstanceId?: string;
}): Promise<void> {
  await _createScheduledMessage({ data: { ...data, media: data.media ?? [] } });
}

export interface ScheduledMessageDetail {
  id: string;
  body: string;
  media: MediaItem[];
  scheduled_at: string;
  status: ScheduledMessageRow["status"];
  recipients: { remote_jid: string; name: string }[];
}

async function assertScheduledMessageInOrg(id: string, organizationId: string): Promise<typeof scheduledMessages.$inferSelect> {
  const [message] = await db.select().from(scheduledMessages).where(eq(scheduledMessages.id, id));
  if (!message || message.organizationId !== organizationId) throw new Error("Mensagem não encontrada.");
  return message;
}

const _fetchScheduledMessageById = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<ScheduledMessageDetail | null> => {
    const { organizationId } = await requireOrgContext();
    const [message] = await db.select().from(scheduledMessages).where(eq(scheduledMessages.id, data.id));
    if (!message || message.organizationId !== organizationId) return null;

    const [recipients, media] = await Promise.all([
      db
        .select()
        .from(scheduledMessageRecipients)
        .where(eq(scheduledMessageRecipients.messageId, data.id)),
      db
        .select({
          base64: scheduledMessageMedia.base64,
          mimetype: scheduledMessageMedia.mimetype,
          filename: scheduledMessageMedia.filename,
        })
        .from(scheduledMessageMedia)
        .where(eq(scheduledMessageMedia.messageId, data.id))
        .orderBy(asc(scheduledMessageMedia.sortOrder)),
    ]);

    // Mensagens antigas (antes de scheduled_message_media existir) guardavam 1 mídia direto nas colunas legadas.
    const legacyMedia: MediaItem[] =
      media.length === 0 && message.mediaBase64 && message.mediaMimetype && message.mediaFilename
        ? [{ base64: message.mediaBase64, mimetype: message.mediaMimetype, filename: message.mediaFilename }]
        : [];

    return {
      id: message.id,
      body: message.body,
      media: media.length > 0 ? media : legacyMedia,
      scheduled_at: message.scheduledAt,
      status: message.status as ScheduledMessageRow["status"],
      recipients: recipients.map((r) => ({ remote_jid: r.remoteJid, name: r.name })),
    };
  });

export async function fetchScheduledMessageById(id: string): Promise<ScheduledMessageDetail | null> {
  return _fetchScheduledMessageById({ data: { id } });
}

const _updateScheduledMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      body: z.string().min(1),
      media: z.array(mediaItemSchema).default([]),
      scheduledAt: z.string(),
      recipients: z.array(z.object({ remoteJid: z.string(), name: z.string() })).min(1),
    })
  )
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await assertScheduledMessageInOrg(data.id, organizationId);
    await db.transaction(async (tx) => {
      const [message] = await tx
        .update(scheduledMessages)
        .set({
          body: data.body,
          scheduledAt: data.scheduledAt,
          // Zera as colunas legadas — a partir da edição, a mídia passa a viver só em scheduled_message_media.
          mediaBase64: null,
          mediaMimetype: null,
          mediaFilename: null,
        })
        .where(and(eq(scheduledMessages.id, data.id), eq(scheduledMessages.status, "pending")))
        .returning();
      if (!message) throw new Error("Só é possível editar mensagens ainda pendentes.");

      await tx.delete(scheduledMessageRecipients).where(eq(scheduledMessageRecipients.messageId, data.id));
      await tx.insert(scheduledMessageRecipients).values(
        data.recipients.map((r) => ({
          messageId: data.id,
          remoteJid: r.remoteJid,
          name: r.name,
          status: "pending" as const,
        }))
      );

      await tx.delete(scheduledMessageMedia).where(eq(scheduledMessageMedia.messageId, data.id));
      if (data.media.length > 0) {
        await tx.insert(scheduledMessageMedia).values(
          data.media.map((m, i) => ({
            messageId: data.id,
            base64: m.base64,
            mimetype: m.mimetype,
            filename: m.filename,
            sortOrder: i,
          }))
        );
      }
    });
  });

export async function updateScheduledMessage(data: {
  id: string;
  body: string;
  media?: MediaItem[];
  scheduledAt: string;
  recipients: { remoteJid: string; name: string }[];
}): Promise<void> {
  await _updateScheduledMessage({ data: { ...data, media: data.media ?? [] } });
}

const _cancelScheduledMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await assertScheduledMessageInOrg(data.id, organizationId);
    await db
      .update(scheduledMessages)
      .set({ status: "canceled" })
      .where(eq(scheduledMessages.id, data.id));
  });

export async function cancelScheduledMessage(id: string): Promise<void> {
  await _cancelScheduledMessage({ data: { id } });
}

export interface EvolutionRecipient {
  remoteJid: string;
  name: string;
  isGroup: boolean;
}

// Cache da lista de grupos por instância — fetchAllGroups na Evolution devolve
// TODOS os grupos (pode passar de 150) e não tem busca por texto no servidor
// dela, então sem isso cada busca nova refazia esse download inteiro (é a
// chamada mais lenta de toda a busca). 5 minutos é o bastante pra cobrir uma
// sessão inteira de uso (abrir vários clientes/automações seguidos) sem
// deixar o resultado velho por muito tempo — grupo novo criado na Evolution
// pode demorar até 5min pra aparecer na busca.
const groupsCache = new Map<string, { data: Array<{ id?: string; subject?: string }>; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

async function fetchAllGroupsCached(url: string, apiKey: string, instance: string): Promise<Array<{ id?: string; subject?: string }>> {
  const cacheKey = `${url}::${instance}`;
  const cached = groupsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const res = await fetch(`${url}/group/fetchAllGroups/${instance}?getParticipants=false`, {
    method: "GET",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
  });
  const groups = (await res.json()) as Array<{ id?: string; subject?: string }>;
  const data = Array.isArray(groups) ? groups : [];
  groupsCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// Mesmo problema dos grupos, mesma solução — findContacts também devolve a
// lista inteira de contatos sem busca por texto no servidor.
const contactsCache = new Map<string, { data: Array<{ remoteJid?: string; pushName?: string | null; isGroup?: boolean }>; expiresAt: number }>();

async function fetchAllContactsCached(url: string, apiKey: string, instance: string): Promise<Array<{ remoteJid?: string; pushName?: string | null; isGroup?: boolean }>> {
  const cacheKey = `${url}::${instance}`;
  const cached = contactsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const res = await fetch(`${url}/chat/findContacts/${instance}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const contacts = (await res.json()) as Array<{ remoteJid?: string; pushName?: string | null; isGroup?: boolean }>;
  const data = Array.isArray(contacts) ? contacts : [];
  contactsCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

const _searchEvolutionRecipients = createServerFn({ method: "GET" })
  .inputValidator(z.object({ query: z.string(), groupsOnly: z.boolean().optional(), instanceId: z.string().optional() }))
  .handler(async ({ data }): Promise<EvolutionRecipient[]> => {
    // Sem instanceId: comportamento de sempre (instância do gestor logado).
    // Com instanceId: busca os grupos de UMA instância específica — usado na
    // tela de editar instância, pra configurar o grupo operacional de um
    // gestor que não é necessariamente quem está logado agora.
    const { url, apiKey, instance } = data.instanceId
      ? await resolveWhatsappInstanceById(data.instanceId)
      : await resolveGestorWhatsappInstance();
    const q = data.query.trim().toLowerCase();

    // Grupos e contatos são fatiados SEPARADAMENTE antes de juntar — senão,
    // numa busca ampla (ou instância com muitos contatos), os 30 primeiros
    // contatos já preenchiam o limite e nenhum grupo aparecia, mesmo com
    // grupos batendo com a busca (bug real: parecia "não acha o grupo").
    const contactResults: EvolutionRecipient[] = [];
    if (!data.groupsOnly) {
      try {
        const contacts = await fetchAllContactsCached(url, apiKey, instance);
        for (const c of contacts) {
          if (!c.remoteJid || c.isGroup) continue;
          const name = c.pushName || c.remoteJid.split("@")[0];
          if (q && !name.toLowerCase().includes(q) && !c.remoteJid.includes(q)) continue;
          contactResults.push({ remoteJid: c.remoteJid, name, isGroup: false });
          if (contactResults.length >= 15) break;
        }
      } catch {
        // segue só com o que conseguir (grupos), não derruba a busca inteira
      }
    }

    const groupResults: EvolutionRecipient[] = [];
    try {
      const groups = await fetchAllGroupsCached(url, apiKey, instance);
      for (const g of groups) {
        if (!g.id) continue;
        const name = g.subject || g.id;
        if (q && !name.toLowerCase().includes(q)) continue;
        groupResults.push({ remoteJid: g.id, name, isGroup: true });
        if (groupResults.length >= 15) break;
      }
    } catch {
      // instância pode estar desconectada — segue só com contatos
    }

    return [...groupResults, ...contactResults];
  });

export async function searchEvolutionRecipients(query: string, groupsOnly?: boolean, instanceId?: string): Promise<EvolutionRecipient[]> {
  return _searchEvolutionRecipients({ data: { query, groupsOnly, instanceId } });
}

const _sendActiveCampaignsList = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), clientName: z.string(), campaignNames: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const { organizationId, role, userId } = await requireOrgContext();
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, ownerUserId: true, whatsappGroupId: true },
    });
    if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");

    const rows = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, "campaigns_list_destination")));
    const destination = rows[0]?.value || "operacional";

    // Sempre sai pela instância do GESTOR, nunca pela instância própria do
    // cliente — mesmo quando o destino é o grupo do cliente. Mandar uma
    // automação interna com o número do próprio cliente conectado já causou
    // mensagem saindo do WhatsApp do cliente pra um contato dele, parecendo
    // que o cliente mandou pra si mesmo. "destination" só decide PRA ONDE vai
    // (ver groupId abaixo), nunca de qual número sai.
    const resolved = await resolveGestorWhatsappInstance();
    const { url, apiKey, instance } = resolved;

    const groupId = destination === "client_group" && client.whatsappGroupId
      ? client.whatsappGroupId
      : await resolveOperationalGroupId(resolved, organizationId);
    if (!groupId) {
      throw new Error("Grupo operacional não configurado pra essa instância. Configure em Configurações → Instâncias WhatsApp.");
    }

    const text = `📋 ${data.campaignNames.length} Campanhas ativas — ${data.clientName}\n\n${data.campaignNames.map((n) => `• ${n}`).join("\n")}`;

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

export async function sendActiveCampaignsList(clientId: string, clientName: string, campaignNames: string[]): Promise<void> {
  await _sendActiveCampaignsList({ data: { clientId, clientName, campaignNames } });
}

export interface WhatsappLabel {
  id: string;
  name: string;
  color?: string;
}

// Lista as etiquetas existentes na instância do cliente — usado no dropdown
// de Configurações do cliente pra escolher qual etiqueta marca um lead como
// qualificado. A Evolution API não expõe qual etiqueta está em qual conversa
// (só via webhook labels.association), mas listar as etiquetas em si funciona.
const _fetchClientWhatsappLabels = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<WhatsappLabel[]> => {
    const { organizationId, role, userId } = await requireOrgContext();
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, ownerUserId: true },
    });
    if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");

    const { url, apiKey, instance } = await resolveClientWhatsappInstance(data.clientId);
    try {
      const res = await fetch(`${url}/label/findLabels/${instance}`, { headers: { apikey: apiKey } });
      const json = (await res.json()) as Array<{ id?: string; name?: string; color?: string }>;
      if (!Array.isArray(json)) return [];
      return json.filter((l): l is { id: string; name: string; color?: string } => !!l.id && !!l.name);
    } catch {
      return [];
    }
  });

export async function fetchClientWhatsappLabels(clientId: string): Promise<WhatsappLabel[]> {
  return _fetchClientWhatsappLabels({ data: { clientId } });
}
