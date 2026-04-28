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

// ── Account info (balance + payment method) ───────────────────

export interface AdAccountBalanceInfo {
  balance: number | null;
}

function parseDisplayStringBalance(displayString: string | undefined): number | null {
  if (!displayString) return null;
  // Matches "R$1.816,15 BRL" or "R$ 1.816,15" (Brazilian format)
  const match = displayString.match(/R\$\s*([\d.,]+)/);
  if (!match) return null;
  const numStr = match[1].replace(/\./g, "").replace(",", ".");
  const brl = parseFloat(numStr);
  return isNaN(brl) ? null : Math.round(brl * 100);
}

export async function fetchAdAccountInfo(adAccountId: string, token: string): Promise<AdAccountBalanceInfo> {
  try {
    const res = await fetch(
      `${BASE_URL}/${adAccountId}?fields=balance,funding_source_details&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json() as {
      balance?: string;
      funding_source_details?: { amount?: string; type?: number; display_string?: string };
      error?: MetaApiError;
    };
    if (json.error) return { balance: null };

    // Priority: fsd.amount → fsd.display_string (parsed) → balance
    // display_string e.g. "Saldo disponível (R$1.816,15 BRL)" is the most reliable for BR accounts
    const fsdAmount = json.funding_source_details?.amount
      ? parseInt(json.funding_source_details.amount, 10)
      : null;
    const displayBalance = parseDisplayStringBalance(json.funding_source_details?.display_string);
    const rawBalance = json.balance !== undefined ? parseInt(json.balance, 10) : null;

    const balance =
      fsdAmount !== null && fsdAmount > 0 ? fsdAmount :
      displayBalance !== null && displayBalance > 0 ? displayBalance :
      rawBalance;

    return { balance };
  } catch {
    return { balance: null };
  }
}

export interface RawAccountBalance {
  balance: string | null;
  funding_source_details: { amount?: string; type?: number; display_string?: string } | null;
  displayBalanceCents: number | null; // parsed from display_string
  error: string | null;
}

export async function fetchRawAccountBalance(adAccountId: string, token: string): Promise<RawAccountBalance> {
  try {
    const res = await fetch(
      `${BASE_URL}/${adAccountId}?fields=balance,funding_source_details&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json() as {
      balance?: string;
      funding_source_details?: { amount?: string; type?: number; display_string?: string };
      error?: { message: string };
    };
    if (json.error) return { balance: null, funding_source_details: null, displayBalanceCents: null, error: json.error.message };
    return {
      balance: json.balance ?? null,
      funding_source_details: json.funding_source_details ?? null,
      displayBalanceCents: parseDisplayStringBalance(json.funding_source_details?.display_string),
      error: null,
    };
  } catch (e) {
    return { balance: null, funding_source_details: null, displayBalanceCents: null, error: String(e) };
  }
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

  // Fetch balance only — payment_method is manually set in the client form and must never be overwritten by sync
  const { balance } = await fetchAdAccountInfo(adAccountId, token);
  if (balance !== null) {
    await supabase.from("clients").update({ meta_balance: balance }).eq("id", clientId);
  }

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

// ── Ad sets & Ads ──────────────────────────────────────────────

export interface MetaTargeting {
  age_min?: number;
  age_max?: number;
  genders?: number[]; // 1 = male, 2 = female, [] = all
  geo_locations?: {
    countries?: string[];
    cities?: Array<{ key: string; name?: string; country?: string; region?: string }>;
  };
  flexible_spec?: Array<{ interests?: Array<{ id: string; name: string }> }>;
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
}

export interface MetaAdCreative {
  id: string;
  body?: string;
  title?: string;
  description?: string;
  thumbnail_url?: string;
  object_story_spec?: {
    link_data?: {
      message?: string;
      name?: string;
      description?: string;
      call_to_action?: {
        type: string;
        value?: { app_destination?: string; whatsapp_number?: string; message?: string; link?: string };
      };
    };
    video_data?: {
      message?: string;
      title?: string;
      description?: string;
      call_to_action?: {
        type: string;
        value?: { app_destination?: string; whatsapp_number?: string };
      };
    };
  };
}

export interface MetaInterest {
  id: string;
  name: string;
}

export interface MetaLocationResult {
  key: string;
  name: string;
  type: string;
  country_code: string;
  region?: string;
}

export async function fetchAdSetTargeting(adSetId: string, token: string): Promise<MetaTargeting> {
  const params = new URLSearchParams({ fields: "targeting", access_token: token });
  const res = await fetch(`${BASE_URL}/${adSetId}?${params}`);
  const json = await res.json() as { targeting?: MetaTargeting; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.targeting ?? {};
}

export async function updateAdSetTargeting(adSetId: string, targeting: MetaTargeting, token: string): Promise<void> {
  await updateMetaObject(adSetId, { targeting: JSON.stringify(targeting) }, token);
}

export async function fetchAdWithCreative(adId: string, token: string): Promise<MetaAdCreative> {
  const params = new URLSearchParams({
    fields: "creative{id,body,title,description,thumbnail_url,object_story_spec}",
    access_token: token,
  });
  const res = await fetch(`${BASE_URL}/${adId}?${params}`);
  const json = await res.json() as { creative?: MetaAdCreative; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.creative ?? { id: "" };
}

export async function updateAdCreative(
  creativeId: string,
  fields: { body?: string; title?: string; description?: string },
  token: string
): Promise<void> {
  const params: Record<string, string> = {};
  if (fields.body !== undefined) params.body = fields.body;
  if (fields.title !== undefined) params.title = fields.title;
  if (fields.description !== undefined) params.description = fields.description;
  await updateMetaObject(creativeId, params, token);
}

export async function searchMetaInterests(query: string, token: string): Promise<MetaInterest[]> {
  const params = new URLSearchParams({ type: "adinterest", q: query, limit: "10", access_token: token });
  const res = await fetch(`${BASE_URL}/search?${params}`);
  const json = await res.json() as { data?: Array<{ id: string; name: string }>; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return (json.data ?? []).map((i) => ({ id: String(i.id), name: i.name }));
}

export async function searchMetaLocations(query: string, token: string): Promise<MetaLocationResult[]> {
  const params = new URLSearchParams({
    type: "adgeolocation",
    q: query,
    "location_types[0]": "city",
    "location_types[1]": "region",
    country_code: "BR",
    limit: "10",
    access_token: token,
  });
  const res = await fetch(`${BASE_URL}/search?${params}`);
  const json = await res.json() as { data?: MetaLocationResult[]; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.data ?? [];
}

export interface MetaAdSet {
  id: string;
  name: string;
  status: string;
  daily_budget: number | null;
  optimization_goal: string;
}

export interface MetaAd {
  id: string;
  name: string;
  status: string;
  thumbnail_url?: string;
}

export async function fetchAdSets(campaignId: string, token: string): Promise<MetaAdSet[]> {
  const params = new URLSearchParams({
    fields: "id,name,status,daily_budget,optimization_goal",
    limit: "50",
    access_token: token,
  });
  const res = await fetch(`${BASE_URL}/${campaignId}/adsets?${params}`);
  const json = await res.json() as {
    data?: Array<{ id: string; name: string; status: string; daily_budget?: string; optimization_goal?: string }>;
    error?: { message: string };
  };
  if (json.error) throw new Error(json.error.message);
  return (json.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    daily_budget: a.daily_budget ? parseFloat(a.daily_budget) / 100 : null,
    optimization_goal: a.optimization_goal ?? "",
  }));
}

export async function fetchAds(adSetId: string, token: string): Promise<MetaAd[]> {
  const params = new URLSearchParams({
    fields: "id,name,status,creative{thumbnail_url}",
    limit: "50",
    access_token: token,
  });
  const res = await fetch(`${BASE_URL}/${adSetId}/ads?${params}`);
  const json = await res.json() as {
    data?: Array<{ id: string; name: string; status: string; creative?: { thumbnail_url?: string } }>;
    error?: { message: string };
  };
  if (json.error) throw new Error(json.error.message);
  return (json.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    thumbnail_url: a.creative?.thumbnail_url,
  }));
}

export async function updateMetaObject(
  id: string,
  fields: Record<string, string>,
  token: string
): Promise<void> {
  await postMeta(id, { ...fields, access_token: token });
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

async function postMetaJson(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { error?: MetaApiError };
  if (json.error) {
    await recordMetaApiError(endpoint, res.status, json.error);
    throw new Error(json.error.message);
  }
  return json;
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

export interface DiagAdAccount {
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
  adAccounts: DiagAdAccount[];
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

  const adAccounts: DiagAdAccount[] = (accountsJson.data ?? []).map((a) => ({
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
 * Duplica uma campanha via cópia manual: cria nova campanha + copia cada ad set + copia cada ad.
 * Cada operação toca exatamente 1 objeto, evitando o limite de 3 objetos por chamada da Meta API.
 */
export async function duplicateCampaign(
  campaignId: string,
  adAccountId: string,
  newName: string,
  token: string,
  onProgress?: (msg: string) => void,
  whatsappNumber?: string // número WhatsApp Business do cliente, injeta no promoted_object se estiver faltando
): Promise<string> {
  onProgress?.("Buscando estrutura da campanha...");

  // 1. Busca campos da campanha original incluindo orçamento (para detectar CBO)
  const srcRes = await fetch(
    `${BASE_URL}/${campaignId}?fields=objective,special_ad_categories,daily_budget&access_token=${encodeURIComponent(token)}`
  );
  const srcJson = (await srcRes.json()) as {
    objective?: string;
    special_ad_categories?: string[];
    daily_budget?: string;
    error?: MetaApiError;
  };
  if (srcJson.error) throw new Error(srcJson.error.message);

  // 2. Busca conjuntos com seus orçamentos (para calcular budget total se não for CBO)
  const adSetsRes = await fetch(
    `${BASE_URL}/${campaignId}/adsets?fields=id,name,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,bid_amount,targeting,destination_type,promoted_object&limit=50&access_token=${encodeURIComponent(token)}`
  );
  const adSetsJson = (await adSetsRes.json()) as {
    data?: Array<{
      id: string;
      name: string;
      daily_budget?: string;
      lifetime_budget?: string;
      billing_event?: string;
      optimization_goal?: string;
      bid_strategy?: string;
      bid_amount?: string;
      targeting?: MetaTargeting;
      destination_type?: string;
      promoted_object?: Record<string, string>;
    }>;
    error?: MetaApiError;
  };
  if (adSetsJson.error) throw new Error(adSetsJson.error.message);
  const adSets = adSetsJson.data ?? [];

  // 3. Determina o orçamento da nova campanha (CBO elimina is_adset_budget_sharing_enabled nos conjuntos)
  //    Fonte: orçamento da campanha original (se CBO) ou soma dos conjuntos
  let campaignDailyBudget = srcJson.daily_budget
    ? parseInt(srcJson.daily_budget, 10)
    : adSets.reduce((sum, s) => sum + (s.daily_budget ? parseInt(s.daily_budget, 10) : 0), 0);

  if (!campaignDailyBudget || campaignDailyBudget < 100) campaignDailyBudget = 5000; // mínimo R$ 50

  onProgress?.(`${adSets.length} conjunto(s) encontrado(s). Criando nova campanha com orçamento de campanha...`);

  // 4. Cria a nova campanha com daily_budget (CBO) — conjuntos não precisam de orçamento próprio
  // Campanha CBO sem bid_strategy explícita — ad sets herdam budget sem exigir is_adset_budget_sharing_enabled
  const newCampaign = (await postMeta(`${adAccountId}/campaigns`, {
    name: newName,
    objective: srcJson.objective ?? "OUTCOME_ENGAGEMENT",
    status: "PAUSED",
    special_ad_categories: "[]",
    daily_budget: String(campaignDailyBudget),
    access_token: token,
  })) as { id: string };

  const newCampaignId = newCampaign.id;

  // 5. Cria cada conjunto do zero no modo CBO:
  //    - Sem daily_budget próprio (herda da campanha)
  //    - Sem is_adset_budget_sharing_enabled (não exigido em CBO)
  //    - Com bid_amount padrão de R$15 para satisfazer qualquer exigência de lance
  for (let i = 0; i < adSets.length; i++) {
    const adSet = adSets[i];
    onProgress?.(`Criando conjunto ${i + 1}/${adSets.length}: ${adSet.name}...`);

    // ── Corrige targeting ──────────────────────────────────────
    const targeting = adSet.targeting ?? { geo_locations: { countries: ["BR"] } };
    // explore_home exige explore junto (regra Meta)
    if (targeting.instagram_positions?.includes("explore_home") && !targeting.instagram_positions.includes("explore")) {
      targeting.instagram_positions = [...targeting.instagram_positions, "explore"];
    }
    // Remove posicionamentos de search que causam conflito com outros
    if (targeting.instagram_positions) {
      targeting.instagram_positions = targeting.instagram_positions.filter(
        (p) => !["ig_search"].includes(p)
      );
    }

    // ── Compatibilidade objetivo × meta de desempenho ──────────
    const srcDestinationType = adSet.destination_type ?? "";

    // destination_type=WHATSAPP exige WhatsApp Business na Página.
    // Se o cliente não tem número WA Business configurado, cai para MESSENGER
    // (mesmo objetivo CONVERSATIONS, sem exigência de WABA).
    const effectiveDestinationType =
      srcDestinationType === "WHATSAPP" && !whatsappNumber
        ? "MESSENGER"
        : srcDestinationType;

    const optimizationGoal = "CONVERSATIONS";
    const billingEvent = "IMPRESSIONS";

    const adSetParams: Record<string, string> = {
      name: adSet.name,
      campaign_id: newCampaignId,
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      targeting: JSON.stringify(targeting),
      bid_amount: "1500",
      status: "PAUSED",
      access_token: token,
    };

    if (effectiveDestinationType) adSetParams.destination_type = effectiveDestinationType;

    // Constrói promoted_object: injeta whatsapp_phone_number para destino WHATSAPP,
    // remove-o se mudou para MESSENGER (campo inválido lá).
    if (adSet.promoted_object || effectiveDestinationType) {
      const po: Record<string, string> = { ...(adSet.promoted_object ?? {}) };
      if (effectiveDestinationType === "WHATSAPP") {
        if (!po.whatsapp_phone_number && whatsappNumber) po.whatsapp_phone_number = whatsappNumber;
      } else {
        delete po.whatsapp_phone_number;
      }
      if (Object.keys(po).length > 0) adSetParams.promoted_object = JSON.stringify(po);
    }

    // ── Validação obrigatória antes de enviar à Meta ───────────
    if (adSetParams.optimization_goal !== "CONVERSATIONS") {
      throw new Error(
        `Validação falhou: optimization_goal do conjunto "${adSet.name}" deveria ser CONVERSATIONS, mas é "${adSetParams.optimization_goal}".`
      );
    }

    let newAdSetRes: { id: string };
    try {
      newAdSetRes = (await postMeta(`${adAccountId}/adsets`, adSetParams)) as { id: string };
    } catch (err) {
      const baseMsg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Falha ao duplicar o conjunto "${adSet.name}" (meta=CONVERSATIONS, destino=${effectiveDestinationType || "—"}): ${baseMsg}`
      );
    }
    const newAdSetId = newAdSetRes.id;

    // Busca anúncios do conjunto original
    const adsRes = await fetch(
      `${BASE_URL}/${adSet.id}/ads?fields=id,name&limit=50&access_token=${encodeURIComponent(token)}`
    );
    const adsJson = (await adsRes.json()) as {
      data?: Array<{ id: string; name: string }>;
      error?: MetaApiError;
    };
    if (adsJson.error) throw new Error(adsJson.error.message);
    const ads = adsJson.data ?? [];

    for (let j = 0; j < ads.length; j++) {
      const ad = ads[j];
      onProgress?.(`Copiando anúncio ${j + 1}/${ads.length} (conjunto ${i + 1})...`);
      await postMeta(`${ad.id}/copies`, {
        adset_id: newAdSetId,
        status_option: "PAUSED",
        access_token: token,
      });
    }
  }

  return newCampaignId;
}

export interface CreateFromScratchOptions {
  name: string;
  adAccountId: string;
  pageId: string;
  whatsappNumber?: string; // E.164, ex: +5511999999999 — obrigatório para destination WHATSAPP
  dailyBudget: number; // BRL
  placements: { facebook: boolean; instagram: boolean };
  token: string;
  campaignType?: "engagement" | "sales";
}

export async function createCampaignFromScratch(
  opts: CreateFromScratchOptions
): Promise<{ campaignId: string; adSetId: string }> {
  const objective = opts.campaignType === "sales" ? "OUTCOME_SALES" : "OUTCOME_ENGAGEMENT";

  const campaign = await postMeta(`${opts.adAccountId}/campaigns`, {
    name: opts.name,
    objective,
    status: "PAUSED",
    special_ad_categories: "[]",
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

  // Se houver número WhatsApp Business → WHATSAPP; caso contrário → MESSENGER (não exige WABA)
  const destinationType = opts.whatsappNumber ? "WHATSAPP" : "MESSENGER";
  const promotedObject: Record<string, string> = { page_id: opts.pageId };
  if (opts.whatsappNumber) promotedObject.whatsapp_phone_number = opts.whatsappNumber;

  const adSet = await postMeta(`${opts.adAccountId}/adsets`, {
    name: opts.name,
    campaign_id: campaignId,
    daily_budget: String(Math.round(opts.dailyBudget * 100)),
    billing_event: "IMPRESSIONS",
    optimization_goal: "CONVERSATIONS",
    destination_type: destinationType,
    promoted_object: JSON.stringify(promotedObject),
    targeting: JSON.stringify(targeting),
    status: "PAUSED",
    access_token: opts.token,
  }) as { id: string };

  return { campaignId, adSetId: adSet.id };
}
