import { supabase } from "./supabase";

const GRAPH_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ── Token storage ──────────────────────────────────────────────

export async function saveMetaToken(token: string, expiresAt: Date) {
  const { error } = await supabase.from("app_config").upsert(
    [
      { key: "meta_access_token", value: token },
      { key: "meta_token_expires_at", value: expiresAt.toISOString() },
    ],
    { onConflict: "key" }
  );
  if (error) throw error;
}

export interface TokenInfo {
  token: string | null;
  expiresAt: Date | null;
  daysUntilExpiry: number | null;
}

export async function getTokenInfo(): Promise<TokenInfo> {
  const { data } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["meta_access_token", "meta_token_expires_at", "last_synced_at"]);

  const tokenRow = data?.find((r) => r.key === "meta_access_token");
  const expiresRow = data?.find((r) => r.key === "meta_token_expires_at");

  if (!tokenRow?.value) return { token: null, expiresAt: null, daysUntilExpiry: null };

  const expiresAt = expiresRow?.value ? new Date(expiresRow.value) : null;

  if (expiresAt && expiresAt < new Date()) {
    return { token: null, expiresAt, daysUntilExpiry: 0 };
  }

  const daysUntilExpiry = expiresAt
    ? Math.floor((expiresAt.getTime() - Date.now()) / 86400000)
    : null;

  return { token: tokenRow.value, expiresAt, daysUntilExpiry };
}

export async function getMetaToken(): Promise<string | null> {
  const { token } = await getTokenInfo();
  return token;
}

export async function getLastSyncedAt(): Promise<Date | null> {
  const { data } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "last_synced_at")
    .maybeSingle();

  return data?.value ? new Date(data.value) : null;
}

// ── Metrics sync ──────────────────────────────────────────────

export interface MetaSyncResult {
  synced: number;
  errors: string[];
  syncedAt: string;
}

export async function syncClientMetrics(
  clientId: string,
  adAccountId: string,
  token: string
): Promise<{ spend: number; leads: number }> {
  const today = new Date().toISOString().slice(0, 10);

  const params = new URLSearchParams({
    fields: "spend,actions",
    date_preset: "today",
    level: "account",
    access_token: token,
  });

  const res = await fetch(`${BASE_URL}/${adAccountId}/insights?${params}`);
  const json = await res.json() as {
    data?: Array<{
      spend?: string;
      actions?: Array<{ action_type: string; value: string }>;
    }>;
    error?: { message: string };
  };

  if (json.error) throw new Error(json.error.message);

  const row = json.data?.[0];
  const spend = parseFloat(row?.spend ?? "0");

  const leadsAction = row?.actions?.find(
    (a) =>
      a.action_type === "onsite_conversion.total_messaging_connection" ||
      a.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
      a.action_type === "messaging_first_reply"
  );
  const leads = leadsAction ? parseInt(leadsAction.value, 10) : 0;

  await supabase.from("metrics_daily").upsert(
    { client_id: clientId, date: today, spend, leads },
    { onConflict: "client_id,date" }
  );

  return { spend, leads };
}

export async function syncAllClients(token: string): Promise<MetaSyncResult> {
  const { data: clients } = await supabase
    .from("clients")
    .select("id, meta_ad_account_id")
    .eq("active", true);

  if (!clients || clients.length === 0) {
    return { synced: 0, errors: [], syncedAt: new Date().toISOString() };
  }

  const results = await Promise.allSettled(
    clients.map((c) => syncClientMetrics(c.id, c.meta_ad_account_id, token))
  );

  const errors: string[] = [];
  let synced = 0;

  results.forEach((r, i) => {
    if (r.status === "fulfilled") synced++;
    else errors.push(`${clients[i].meta_ad_account_id}: ${r.reason}`);
  });

  const syncedAt = new Date().toISOString();

  await Promise.all([
    supabase.from("sync_log").insert({
      status: errors.length === 0 ? "success" : "error",
      message: errors.length > 0 ? errors.join("; ") : null,
    }),
    supabase.from("app_config").upsert({ key: "last_synced_at", value: syncedAt }, { onConflict: "key" }),
  ]);

  return { synced, errors, syncedAt };
}

// ── Daily insights (chart) ─────────────────────────────────────

export interface DailyInsight {
  date: string; // YYYY-MM-DD
  spend: number;
  leads: number;
  cpl: number | null;
}

export async function fetchDailyInsights(
  adAccountId: string,
  token: string,
  datePreset: DatePreset = "this_month",
  customRange?: CustomDateRange
): Promise<DailyInsight[]> {
  const params: Record<string, string> = {
    fields: "date_start,spend,actions",
    level: "account",
    time_increment: "1",
    access_token: token,
  };

  if (customRange) {
    params["time_range"] = JSON.stringify(customRange);
  } else {
    params["date_preset"] = datePreset;
  }

  const res = await fetch(`${BASE_URL}/${adAccountId}/insights?${new URLSearchParams(params)}`);
  const json = await res.json() as {
    data?: Array<{
      date_start: string;
      spend?: string;
      actions?: Array<{ action_type: string; value: string }>;
    }>;
    error?: { message: string };
  };

  if (json.error) throw new Error(json.error.message);

  return (json.data ?? []).map((row) => {
    const spend = parseFloat(row.spend ?? "0");
    const leadsAction = row.actions?.find(
      (a) =>
        a.action_type === "onsite_conversion.total_messaging_connection" ||
        a.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
        a.action_type === "messaging_first_reply"
    );
    const leads = leadsAction ? parseInt(leadsAction.value, 10) : 0;
    return {
      date: row.date_start,
      spend,
      leads,
      cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
    };
  });
}

// ── Campaigns ──────────────────────────────────────────────────

export type DatePreset =
  | "today"
  | "yesterday"
  | "this_week_mon_today"
  | "last_week_mon_sun"
  | "this_month"
  | "maximum";

export interface CustomDateRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | string;
  daily_budget: number | null;
  objective: string;
  spend: number;
  leads: number;
  cpl: number | null;
  impressions: number;
  link_clicks: number;
  ctr: number | null;
  cpm: number | null;
}

export async function fetchCampaigns(
  adAccountId: string,
  token: string,
  datePreset: DatePreset = "today",
  customRange?: CustomDateRange
): Promise<MetaCampaign[]> {
  const campaignsParams = new URLSearchParams({
    fields: "id,name,status,daily_budget,objective",
    limit: "100",
    access_token: token,
  });

  const insightsBase: Record<string, string> = {
    fields: "campaign_id,spend,actions,impressions,inline_link_clicks,ctr,cpm",
    level: "campaign",
    access_token: token,
  };

  if (customRange) {
    insightsBase["time_range"] = JSON.stringify(customRange);
  } else {
    insightsBase["date_preset"] = datePreset;
  }

  const insightsParams = new URLSearchParams(insightsBase);

  const [campaignsRes, insightsRes] = await Promise.all([
    fetch(`${BASE_URL}/${adAccountId}/campaigns?${campaignsParams}`),
    fetch(`${BASE_URL}/${adAccountId}/insights?${insightsParams}`),
  ]);

  const [campaignsJson, insightsJson] = await Promise.all([
    campaignsRes.json() as Promise<{
      data?: Array<{
        id: string;
        name: string;
        status: string;
        daily_budget?: string;
        objective: string;
      }>;
      error?: { message: string };
    }>,
    insightsRes.json() as Promise<{
      data?: Array<{
        campaign_id: string;
        spend?: string;
        impressions?: string;
        inline_link_clicks?: string;
        ctr?: string;
        cpm?: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    }>,
  ]);

  if (campaignsJson.error) throw new Error(campaignsJson.error.message);

  const insightsMap = new Map(
    (insightsJson.data ?? []).map((row) => [row.campaign_id, row])
  );

  const campaigns = (campaignsJson.data ?? [])
    .filter((c) => c.status !== "ARCHIVED" && c.status !== "DELETED")
    .map((c) => {
      const ins = insightsMap.get(c.id);
      const spend = parseFloat(ins?.spend ?? "0");
      const impressions = parseInt(ins?.impressions ?? "0", 10);
      const linkClicks = parseInt(ins?.inline_link_clicks ?? "0", 10);
      const ctr = ins?.ctr ? parseFloat(ins.ctr) : null;
      const cpm = ins?.cpm ? parseFloat(ins.cpm) : null;

      const leadsAction = ins?.actions?.find(
        (a) =>
          a.action_type === "onsite_conversion.total_messaging_connection" ||
          a.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
          a.action_type === "messaging_first_reply"
      );
      const leads = leadsAction ? parseInt(leadsAction.value, 10) : 0;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
        objective: c.objective,
        spend,
        leads,
        cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
        impressions,
        link_clicks: linkClicks,
        ctr,
        cpm,
      };
    });

  // Ativas primeiro, depois pausadas — por gasto decrescente dentro de cada grupo
  return campaigns.sort((a, b) => {
    if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
    if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
    return b.spend - a.spend;
  });
}

// ── Campaign creation ──────────────────────────────────────────

interface MetaApiError {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

async function recordMetaApiError(endpoint: string, status: number, error: MetaApiError) {
  try {
    const safe = {
      endpoint,
      status,
      message: error.message,
      type: error.type,
      code: error.code,
      error_subcode: error.error_subcode,
      error_user_title: error.error_user_title,
      error_user_msg: error.error_user_msg,
      fbtrace_id: error.fbtrace_id,
    };
    await supabase.from("app_config").upsert(
      [
        { key: "last_meta_api_error", value: JSON.stringify(safe) },
        { key: "last_meta_api_error_at", value: new Date().toISOString() },
        { key: "last_meta_api_endpoint", value: endpoint },
      ],
      { onConflict: "key" }
    );
  } catch {
    // never let logging break the actual flow
  }
}

async function postMeta(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { error?: MetaApiError };
  if (json.error) {
    await recordMetaApiError(endpoint, res.status, json.error);
    throw new Error(json.error.message);
  }
  return json;
}

// ── Diagnostics ───────────────────────────────────────────────

export type PermissionStatus = "granted" | "declined" | "missing";

export interface PermissionInfo {
  permission: string;
  status: PermissionStatus;
  required: boolean;
  description: string;
}

export interface AdAccountInfo {
  id: string;
  name: string;
  account_status: number;
}

export interface LastMetaError {
  endpoint: string;
  status: number;
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  at: string;
}

export interface MetaDiagnostics {
  hasToken: boolean;
  maskedToken: string | null;
  expiresAt: Date | null;
  daysUntilExpiry: number | null;
  user: { id: string; name: string } | null;
  tokenError: string | null;
  permissions: PermissionInfo[];
  adAccounts: AdAccountInfo[];
  adAccountsError: string | null;
  lastError: LastMetaError | null;
  hints: string[];
}

const REQUIRED_PERMISSIONS: Array<{
  name: string;
  required: boolean;
  description: string;
}> = [
  { name: "ads_read", required: true, description: "Ler campanhas, conjuntos e métricas." },
  { name: "ads_management", required: true, description: "Criar, duplicar e editar campanhas via API." },
  { name: "business_management", required: false, description: "Necessária quando o app/conta usa Business Manager." },
  { name: "pages_show_list", required: false, description: "Listar páginas do Facebook do usuário." },
  { name: "pages_manage_ads", required: false, description: "Gerenciar anúncios vinculados à página." },
  { name: "pages_read_engagement", required: false, description: "Ler informações da página vinculada." },
];

function maskToken(token: string): string {
  if (token.length <= 16) return `${token.slice(0, 4)}${"•".repeat(8)}${token.slice(-4)}`;
  return `${token.slice(0, 10)}${"•".repeat(16)}${token.slice(-6)}`;
}

export async function getLastMetaError(): Promise<LastMetaError | null> {
  const { data } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["last_meta_api_error", "last_meta_api_error_at", "last_meta_api_endpoint"]);

  const errRow = data?.find((r) => r.key === "last_meta_api_error");
  const atRow = data?.find((r) => r.key === "last_meta_api_error_at");
  if (!errRow?.value) return null;

  try {
    const parsed = JSON.parse(errRow.value) as Omit<LastMetaError, "at">;
    return { ...parsed, at: atRow?.value ?? new Date().toISOString() };
  } catch {
    return null;
  }
}

export async function clearLastMetaError(): Promise<void> {
  await supabase
    .from("app_config")
    .delete()
    .in("key", ["last_meta_api_error", "last_meta_api_error_at", "last_meta_api_endpoint"]);
}

export async function runMetaDiagnostics(): Promise<MetaDiagnostics> {
  const tokenInfo = await getTokenInfo();
  const lastError = await getLastMetaError();

  if (!tokenInfo.token) {
    return {
      hasToken: false,
      maskedToken: null,
      expiresAt: tokenInfo.expiresAt,
      daysUntilExpiry: tokenInfo.daysUntilExpiry,
      user: null,
      tokenError: "Nenhum token configurado.",
      permissions: REQUIRED_PERMISSIONS.map((p) => ({
        permission: p.name,
        status: "missing" as PermissionStatus,
        required: p.required,
        description: p.description,
      })),
      adAccounts: [],
      adAccountsError: null,
      lastError,
      hints: ["Acesse Configurações e cole um token Meta válido para começar."],
    };
  }

  const token = tokenInfo.token;
  const masked = maskToken(token);

  const [meRes, permRes, accountsRes] = await Promise.all([
    fetch(`${BASE_URL}/me?access_token=${encodeURIComponent(token)}`),
    fetch(`${BASE_URL}/me/permissions?access_token=${encodeURIComponent(token)}`),
    fetch(
      `${BASE_URL}/me/adaccounts?fields=id,account_id,name,account_status&limit=200&access_token=${encodeURIComponent(
        token
      )}`
    ),
  ]);

  const meJson = (await meRes.json()) as {
    id?: string;
    name?: string;
    error?: MetaApiError;
  };
  const permJson = (await permRes.json()) as {
    data?: Array<{ permission: string; status: string }>;
    error?: MetaApiError;
  };
  const accountsJson = (await accountsRes.json()) as {
    data?: Array<{ id: string; name: string; account_status: number }>;
    error?: MetaApiError;
  };

  const tokenError = meJson.error?.message ?? null;
  const user = meJson.id && meJson.name ? { id: meJson.id, name: meJson.name } : null;

  const grantedMap = new Map<string, PermissionStatus>();
  (permJson.data ?? []).forEach((p) => {
    grantedMap.set(
      p.permission,
      p.status === "granted" ? "granted" : p.status === "declined" ? "declined" : "missing"
    );
  });

  const permissions: PermissionInfo[] = REQUIRED_PERMISSIONS.map((p) => ({
    permission: p.name,
    status: grantedMap.get(p.name) ?? "missing",
    required: p.required,
    description: p.description,
  }));

  const adAccounts: AdAccountInfo[] = (accountsJson.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    account_status: a.account_status,
  }));

  // Build hints
  const hints: string[] = [];

  const adsManagement = permissions.find((p) => p.permission === "ads_management");
  if (adsManagement?.status !== "granted") {
    hints.push(
      "Permissão ads_management ausente ou recusada. Gere um novo token marcando ads_management no Graph API Explorer."
    );
  }

  if (lastError && lastError.code === 3) {
    hints.push(
      "Erro Meta (#3) ‘Application does not have the capability to make this API call’: o token tem a permissão, mas o app Meta não tem capacidade aprovada para escrita na Marketing API. Revise no painel do app Meta: produto Marketing API adicionado, modo Live, App Review com Advanced Access para ads_management."
    );
  }

  if (lastError && (lastError.code === 200 || lastError.code === 10)) {
    hints.push(
      "Erro de permissão na conta de anúncios. Confirme no Business Manager se o usuário/system user do token é admin/anunciante da conta act_..."
    );
  }

  if (adAccounts.length === 0 && !accountsJson.error) {
    hints.push(
      "Nenhuma conta de anúncios visível para este token. Verifique acesso do usuário no Business Manager."
    );
  }

  if (accountsJson.error) {
    hints.push(`Erro ao listar contas de anúncios: ${accountsJson.error.message}`);
  }

  if (hints.length === 0 && !tokenError) {
    hints.push("Token válido e permissões básicas concedidas. Se ainda houver erro, ele aparecerá em ‘Última resposta da API’.");
  }

  return {
    hasToken: true,
    maskedToken: masked,
    expiresAt: tokenInfo.expiresAt,
    daysUntilExpiry: tokenInfo.daysUntilExpiry,
    user,
    tokenError,
    permissions,
    adAccounts,
    adAccountsError: accountsJson.error?.message ?? null,
    lastError,
    hints,
  };
}

/**
 * Duplica uma campanha usando o modo assíncrono da API da Meta.
 * O modo síncrono falha quando a campanha tem mais de 3 objetos (campanha + ad sets + ads).
 * Ref: https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/copies/
 */
export async function duplicateCampaign(
  campaignId: string,
  adAccountId: string,
  newName: string,
  token: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  onProgress?.("Iniciando cópia assíncrona...");

  // 1. Dispara cópia assíncrona — retorna ad_copy_id imediatamente
  const copy = await postMeta(`${campaignId}/copies`, {
    ad_account_id: adAccountId,
    deep_copy: "1",
    status_option: "PAUSED",
    async: "true",
    access_token: token,
  }) as { ad_copy_id?: string; copied_campaign_id?: string };

  // Em alguns casos a Meta ainda devolve o id direto (campanha pequena) — usa atalho
  if (copy.copied_campaign_id && !copy.ad_copy_id) {
    await postMeta(copy.copied_campaign_id, { name: newName, access_token: token });
    return copy.copied_campaign_id;
  }

  if (!copy.ad_copy_id) {
    throw new Error("Meta não retornou ad_copy_id nem copied_campaign_id.");
  }

  const adCopyId = copy.ad_copy_id;
  onProgress?.("Aguardando a Meta finalizar a cópia...");

  // 2. Polling do status do job assíncrono
  const newId = await pollCopyJob(adCopyId, token, onProgress);

  // 3. Renomeia a campanha copiada
  await postMeta(newId, { name: newName, access_token: token });

  return newId;
}

async function pollCopyJob(
  adCopyId: string,
  token: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const maxAttempts = 60; // ~3 minutos com 3s entre tentativas
  const intervalMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const url = `${BASE_URL}/${adCopyId}?fields=async_status,copied_campaign_id,ad_object_copy_entries&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      error?: MetaApiError;
      async_status?: string;
      copied_campaign_id?: string;
    };

    if (json.error) {
      await recordMetaApiError(`${adCopyId} (poll)`, res.status, json.error);
      throw new Error(json.error.message);
    }

    const status = json.async_status ?? "";
    onProgress?.(`Status: ${status} (tentativa ${attempt}/${maxAttempts})`);

    // Estados terminais conhecidos: "Completed", "Completed with Errors"
    if (status.startsWith("Completed")) {
      if (!json.copied_campaign_id) {
        throw new Error(`Cópia finalizou (${status}) mas a Meta não retornou copied_campaign_id.`);
      }
      return json.copied_campaign_id;
    }

    if (status === "Failed" || status === "Error" || status === "Canceled") {
      throw new Error(`Cópia assíncrona falhou na Meta (status: ${status}).`);
    }
    // Demais estados ("Initial", "Pending", "Running", "Processing"…) → continua esperando
  }

  throw new Error("Timeout aguardando a Meta finalizar a cópia da campanha.");
}

export interface CreateFromScratchOptions {
  name: string;
  adAccountId: string;
  pageId: string;
  dailyBudget: number; // BRL
  placements: { facebook: boolean; instagram: boolean };
  token: string;
}

export async function createCampaignFromScratch(
  opts: CreateFromScratchOptions
): Promise<{ campaignId: string; adSetId: string }> {
  const campaign = await postMeta(`${opts.adAccountId}/campaigns`, {
    name: opts.name,
    objective: "MESSAGES",
    status: "PAUSED",
    "special_ad_categories[0]": "NONE",
    access_token: opts.token,
  }) as { id: string };

  const campaignId = campaign.id;

  const publisher_platforms: string[] = [];
  const facebook_positions: string[] = [];
  const instagram_positions: string[] = [];

  if (opts.placements.facebook) {
    publisher_platforms.push("facebook");
    facebook_positions.push("feed", "story");
  }
  if (opts.placements.instagram) {
    publisher_platforms.push("instagram");
    instagram_positions.push("stream", "story");
  }

  const targeting: Record<string, unknown> = { geo_locations: { countries: ["BR"] } };
  if (publisher_platforms.length) targeting.publisher_platforms = publisher_platforms;
  if (facebook_positions.length) targeting.facebook_positions = facebook_positions;
  if (instagram_positions.length) targeting.instagram_positions = instagram_positions;

  const adSet = await postMeta(`${opts.adAccountId}/adsets`, {
    name: opts.name,
    campaign_id: campaignId,
    daily_budget: String(Math.round(opts.dailyBudget * 100)),
    billing_event: "IMPRESSIONS",
    optimization_goal: "CONVERSATIONS",
    destination_type: "WHATSAPP",
    promoted_object: JSON.stringify({ page_id: opts.pageId }),
    targeting: JSON.stringify(targeting),
    status: "PAUSED",
    access_token: opts.token,
  }) as { id: string };

  return { campaignId, adSetId: adSet.id };
}
