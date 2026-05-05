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

export async function getOpenAIKey(): Promise<string | null> {
  const { data } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "openai_api_key")
    .maybeSingle();
  return data?.value ?? null;
}

export async function saveOpenAIKey(key: string): Promise<void> {
  const { error } = await supabase.from("app_config").upsert(
    { key: "openai_api_key", value: key },
    { onConflict: "key" }
  );
  if (error) throw error;
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

export async function fetchAccountInsightsForRange(
  adAccountId: string,
  token: string,
  since: string,
  until: string,
): Promise<{ spend: number; leads: number }> {
  const params = new URLSearchParams({
    fields: "spend,actions",
    time_range: JSON.stringify({ since, until }),
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

  if (json.error) return { spend: 0, leads: 0 };

  const row = json.data?.[0];
  const spend = parseFloat(row?.spend ?? "0");
  const leadsAction = row?.actions?.find(
    (a) =>
      a.action_type === "onsite_conversion.total_messaging_connection" ||
      a.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
      a.action_type === "messaging_first_reply"
  );
  const leads = leadsAction ? parseInt(leadsAction.value, 10) : 0;

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

export async function fetchCampaignById(
  campaignId: string,
  token: string
): Promise<MetaCampaign> {
  const res = await fetch(
    `${BASE_URL}/${campaignId}?fields=id,name,status,daily_budget,objective&access_token=${encodeURIComponent(token)}`
  );
  const json = (await res.json()) as {
    id: string;
    name: string;
    status: string;
    daily_budget?: string;
    objective: string;
    error?: MetaApiError;
  };
  if (json.error) throw new Error(formatMetaError(json.error));
  return {
    id: json.id,
    name: json.name,
    status: json.status,
    daily_budget: json.daily_budget ? parseFloat(json.daily_budget) / 100 : null,
    objective: json.objective,
    spend: 0,
    leads: 0,
    cpl: null,
    impressions: 0,
    link_clicks: 0,
    ctr: null,
    cpm: null,
  };
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
  targeting_automation?: { advantage_audience?: number };
}

export interface MetaAdCreative {
  id: string;
  actor_id?: string; // page_id
  video_id?: string; // direct field exposed on some creative types
  whatsapp_number?: string; // fetched from page when available
  body?: string;
  title?: string;
  description?: string;
  thumbnail_url?: string;
  object_story_spec?: {
    page_id?: string;
    link_data?: {
      message?: string;
      name?: string;
      description?: string;
      link?: string;
      image_hash?: string;
      call_to_action?: {
        type: string;
        value?: { app_destination?: string; whatsapp_number?: string; message?: string; link?: string };
      };
    };
    video_data?: {
      video_id?: string;
      message?: string;
      title?: string;
      description?: string;
      call_to_action?: {
        type: string;
        value?: { app_destination?: string; whatsapp_number?: string };
      };
    };
  };
  asset_feed_spec?: {
    bodies?: Array<{ text: string }>;
    titles?: Array<{ text: string }>;
    descriptions?: Array<{ text: string }>;
    images?: Array<{ hash: string }>;
    videos?: Array<{ video_id: string; thumbnail_hash?: string }>;
    call_to_action_types?: string[];
    call_to_actions?: Array<{ type: string; value?: Record<string, string> }>;
    page_ids?: string[];
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

export interface SelectedLocation {
  key: string;
  name: string;
  type: string; // "city" | "region"
  region?: string; // nome do estado, para cidades
  radius?: number; // km — apenas para cidades; omitido = só a cidade
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
  const get = async (fields: string) => {
    const res = await fetch(`${BASE_URL}/${adId}?${new URLSearchParams({ fields, access_token: token })}`);
    return res.json() as Promise<{ creative?: Record<string, unknown>; error?: { message: string } }>;
  };

  // Step 1: safe base fetch — fields we know work for all creative types
  let base: Record<string, unknown> = {};
  for (const fields of [
    "creative{id,actor_id,body,title,description,thumbnail_url}",
    "creative{id,actor_id,body,title,thumbnail_url}",
    "creative{id,body,title,thumbnail_url}",
  ]) {
    const json = await get(fields);
    if (!json.error && json.creative && json.creative["id"]) { base = json.creative; break; }
  }
  if (!base["id"]) throw new Error("Não foi possível carregar o criativo.");

  const creative: MetaAdCreative = base as unknown as MetaAdCreative;

  // Fetch directly from the creative's own endpoint (different fields available)
  const creativeId = creative.id;
  const getCreative = async (fields: string) => {
    const res = await fetch(`${BASE_URL}/${creativeId}?${new URLSearchParams({ fields, access_token: token })}`);
    return res.json() as Promise<Record<string, unknown> & { error?: { message: string } }>;
  };

  // Step 2: get object_story_spec — try via ad endpoint (different access than creative endpoint)
  for (const fields of [
    "creative{object_story_spec{page_id,video_data{video_id,message,title,description,call_to_action}}}",
    "creative{object_story_spec{page_id,link_data{image_hash,link,message,name,description,call_to_action}}}",
  ]) {
    try {
      const json = await get(fields);
      const spec = json.creative?.["object_story_spec"] as MetaAdCreative["object_story_spec"] | undefined;
      const hasVideo = !!(spec?.video_data?.video_id);
      const hasLink = !!(spec?.link_data?.image_hash || spec?.link_data?.link);
      if (spec && (hasVideo || hasLink)) { creative.object_story_spec = spec; break; }
    } catch { /* ignore */ }
  }

  // Step 3: get video_id and image_hash directly from creative endpoint
  if (!creative.video_id && !creative.object_story_spec?.video_data?.video_id) {
    try {
      const json = await getCreative("video_id,image_hash");
      if (!json.error) {
        if (json["video_id"]) creative.video_id = json["video_id"] as string;
      }
    } catch { /* ignore */ }
    if (!creative.video_id) {
      try {
        const json = await getCreative("video_id");
        if (!json.error && json["video_id"]) creative.video_id = json["video_id"] as string;
      } catch { /* ignore */ }
    }
  }

  // Step 4: get real page_id and whatsapp_phone_number from ad set's promoted_object
  try {
    const adRes = await fetch(`${BASE_URL}/${adId}?${new URLSearchParams({ fields: "adset_id", access_token: token })}`);
    const adJson = await adRes.json() as { adset_id?: string };
    if (adJson.adset_id) {
      const adsetRes = await fetch(`${BASE_URL}/${adJson.adset_id}?${new URLSearchParams({ fields: "promoted_object", access_token: token })}`);
      const adsetJson = await adsetRes.json() as { promoted_object?: { page_id?: string; application_id?: string; whatsapp_phone_number?: string } };
      const pageId = adsetJson.promoted_object?.page_id;
      const waNum = adsetJson.promoted_object?.whatsapp_phone_number;
      if (pageId) creative.actor_id = pageId;
      if (waNum && !creative.whatsapp_number) creative.whatsapp_number = waNum.replace(/\D/g, "");
    }
  } catch { /* ignore */ }

  // Step 5: get WhatsApp number from page (required for CTA in CONVERSATIONS ads)
  if (creative.actor_id && !creative.whatsapp_number) {
    try {
      const res = await fetch(`${BASE_URL}/${creative.actor_id}?${new URLSearchParams({ fields: "whatsapp_number", access_token: token })}`);
      const json = await res.json() as { whatsapp_number?: string };
      if (json.whatsapp_number) creative.whatsapp_number = json.whatsapp_number.replace(/\D/g, "");
    } catch { /* ignore */ }
  }

  // Step 7: asset_feed_spec (Advantage+ / dynamic creative)
  if (!creative.object_story_spec && !creative.asset_feed_spec) {
    try {
      const json = await getCreative("asset_feed_spec");
      const feed = json["asset_feed_spec"] as MetaAdCreative["asset_feed_spec"] | undefined;
      if (feed && !json.error) creative.asset_feed_spec = feed;
    } catch { /* ignore */ }
  }

  console.log("[AdCreative]", creativeId, JSON.stringify({
    page_id: creative.actor_id,
    video_id: creative.video_id ?? creative.object_story_spec?.video_data?.video_id,
    whatsapp_number: creative.whatsapp_number ?? "(not found)",
    has_video_data: !!creative.object_story_spec?.video_data?.video_id,
    has_link_data: !!(creative.object_story_spec?.link_data?.image_hash || creative.object_story_spec?.link_data?.link),
    has_cta: !!(creative.object_story_spec?.video_data?.call_to_action ?? creative.object_story_spec?.link_data?.call_to_action),
    has_feed: !!creative.asset_feed_spec,
  }));
  return creative;
}

async function fetchAdAccountId(adId: string, token: string): Promise<string> {
  const params = new URLSearchParams({ fields: "account_id", access_token: token });
  const res = await fetch(`${BASE_URL}/${adId}?${params}`);
  const json = await res.json() as { account_id?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  if (!json.account_id) throw new Error("account_id não encontrado");
  const id = json.account_id;
  return id.startsWith("act_") ? id : `act_${id}`;
}

export async function waitForVideoReady(
  videoId: string,
  token: string,
  onProgress?: (msg: string) => void
): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    await new Promise<void>((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(
        `${BASE_URL}/${videoId}?fields=picture,status&access_token=${encodeURIComponent(token)}`
      );
      const json = await res.json() as {
        picture?: string;
        status?: { video_status?: string; processing_progress?: number };
        error?: MetaApiError;
      };
      if (json.error) break;
      const pct = json.status?.processing_progress ?? 0;
      const st = json.status?.video_status;
      onProgress?.(`Processando vídeo... ${pct}%`);
      if (st === "ready" || st === "complete") return json.picture ?? null;
      if (st === "error") throw new Error("A Meta não conseguiu processar o vídeo. Tente outro arquivo.");
    } catch (err) {
      if (err instanceof Error && err.message.includes("processar")) throw err;
    }
  }
  throw new Error("Timeout: o vídeo demorou mais que 2 minutos para processar. Tente novamente.");
}

export async function swapAdCreativeMedia(
  adId: string,
  creative: MetaAdCreative,
  mediaFile: File,
  token: string,
  clientWhatsappNumber?: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const accountId = await fetchAdAccountId(adId, token);
  const isVideo = !!(creative.video_id || creative.object_story_spec?.video_data?.video_id);
  const pageId = creative.actor_id ?? creative.object_story_spec?.page_id;
  const resolvedWa = (clientWhatsappNumber ?? creative.whatsapp_number ?? "").replace(/\D/g, "");
  const primaryText = creative.body ?? creative.object_story_spec?.video_data?.message ?? creative.object_story_spec?.link_data?.message ?? "";
  const title = creative.title ?? creative.object_story_spec?.video_data?.title ?? creative.object_story_spec?.link_data?.name ?? "";
  const description = creative.description ?? "";

  if (!pageId) throw new Error("page_id não encontrado no criativo.");

  if (isVideo) {
    onProgress?.("Enviando vídeo...");
    const videoId = await uploadAdVideo(accountId, mediaFile, token);
    const thumbUrl = (await waitForVideoReady(videoId, token, onProgress)) ?? creative.thumbnail_url;
    if (!resolvedWa) throw new Error("Número WhatsApp não encontrado. Cadastre o número em Configurações do cliente.");
    onProgress?.("Criando criativo...");
    const newCreative = (await postMeta(`${accountId}/adcreatives`, {
      name: `media_swap_${Date.now()}`,
      object_story_spec: JSON.stringify({
        page_id: pageId,
        video_data: {
          video_id: videoId,
          message: primaryText,
          title,
          ...(description ? { description } : {}),
          ...(thumbUrl ? { image_url: thumbUrl } : {}),
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", whatsapp_number: resolvedWa } },
        },
      }),
      access_token: token,
    })) as { id: string };
    await updateMetaObject(adId, { creative: JSON.stringify({ creative_id: newCreative.id }) }, token);
    return;
  }

  onProgress?.("Enviando imagem...");
  const imageHash = await uploadAdImage(accountId, mediaFile, token);
  onProgress?.("Criando criativo...");
  const waLink = resolvedWa ? `https://wa.me/${resolvedWa}` : undefined;
  const newCreative = (await postMeta(`${accountId}/adcreatives`, {
    name: `media_swap_${Date.now()}`,
    object_story_spec: JSON.stringify({
      page_id: pageId,
      link_data: {
        image_hash: imageHash,
        message: primaryText,
        name: title,
        ...(description ? { description } : {}),
        ...(waLink
          ? { link: waLink, call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", whatsapp_number: resolvedWa } } }
          : {}),
      },
    }),
    access_token: token,
  })) as { id: string };
  await updateMetaObject(adId, { creative: JSON.stringify({ creative_id: newCreative.id }) }, token);
}

export async function updateAdCreative(
  adId: string,
  creative: MetaAdCreative,
  updates: { body?: string; title?: string; description?: string },
  token: string,
  clientWhatsappNumber?: string // from client record in Supabase — most reliable source
): Promise<void> {
  // Try direct update on the creative first (works for drafts)
  try {
    const params: Record<string, string> = {};
    if (updates.body !== undefined) params.body = updates.body;
    if (updates.title !== undefined) params.title = updates.title;
    if (updates.description !== undefined) params.description = updates.description;
    await updateMetaObject(creative.id, params, token);
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("100")) throw err;
  }

  const accountId = await fetchAdAccountId(adId, token);

  // Try via object_story_spec — only if we have the required media reference
  const spec = creative.object_story_spec;
  const specPageId = spec?.page_id ?? creative.actor_id;
  const hasValidVideoData = !!(spec?.video_data?.video_id);
  const hasValidLinkData = !!(spec?.link_data && (spec.link_data.image_hash || spec.link_data.link));

  if (specPageId && (hasValidVideoData || hasValidLinkData)) {
    const baseSpec = { ...spec, page_id: specPageId };
    const updatedSpec = hasValidVideoData
      ? {
          ...baseSpec,
          video_data: {
            ...spec!.video_data,
            ...(updates.body !== undefined ? { message: updates.body } : {}),
            ...(updates.title !== undefined ? { title: updates.title } : {}),
            ...(updates.description !== undefined ? { description: updates.description } : {}),
          },
        }
      : {
          ...baseSpec,
          link_data: {
            ...spec!.link_data,
            ...(updates.body !== undefined ? { message: updates.body } : {}),
            ...(updates.title !== undefined ? { name: updates.title } : {}),
            ...(updates.description !== undefined ? { description: updates.description } : {}),
          },
        };

    const newCreative = (await postMeta(`${accountId}/adcreatives`, {
      name: `edited_${Date.now()}`,
      object_story_spec: JSON.stringify(updatedSpec),
      access_token: token,
    })) as { id: string };
    await updateMetaObject(adId, { creative: JSON.stringify({ creative_id: newCreative.id }) }, token);
    return;
  }

  // Try via asset_feed_spec (dynamic/advantage+ ads)
  const feed = creative.asset_feed_spec;
  const feedPageId = feed?.page_ids?.[0] ?? creative.actor_id;
  if (feedPageId && feed) {
    const updatedFeed = {
      ...feed,
      page_ids: [feedPageId],
      ...(updates.body !== undefined ? { bodies: [{ text: updates.body }] } : {}),
      ...(updates.title !== undefined ? { titles: [{ text: updates.title }] } : {}),
      ...(updates.description !== undefined ? { descriptions: [{ text: updates.description }] } : {}),
    };
    const newCreative = (await postMeta(`${accountId}/adcreatives`, {
      name: `edited_${Date.now()}`,
      asset_feed_spec: JSON.stringify(updatedFeed),
      access_token: token,
    })) as { id: string };
    await updateMetaObject(adId, { creative: JSON.stringify({ creative_id: newCreative.id }) }, token);
    return;
  }

  // Strategy D: reconstruct spec from video_id + page_id (CONVERSATIONS/OUTCOME_SALES video ads)
  // Used when object_story_spec is not accessible (Meta blocks it for some campaign types)
  const videoId = creative.video_id ?? creative.object_story_spec?.video_data?.video_id;
  const pageId2 = creative.actor_id ?? creative.object_story_spec?.page_id;
  if (videoId && pageId2) {
    const resolvedWa = (clientWhatsappNumber ?? creative.whatsapp_number ?? "").replace(/\D/g, "");
    if (!resolvedWa) throw new Error("Número WhatsApp não encontrado. Cadastre o número em Configurações do cliente.");

    const newCreative = (await postMeta(`${accountId}/adcreatives`, {
      name: `edited_${Date.now()}`,
      object_story_spec: JSON.stringify({
        page_id: pageId2,
        video_data: {
          video_id: videoId,
          message: updates.body ?? creative.body ?? "",
          title: updates.title ?? creative.title ?? "",
          ...(updates.description ? { description: updates.description } : {}),
          ...(creative.thumbnail_url ? { image_url: creative.thumbnail_url } : {}),
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", whatsapp_number: resolvedWa } },
        },
      }),
      access_token: token,
    })) as { id: string };
    await updateMetaObject(adId, { creative: JSON.stringify({ creative_id: newCreative.id }) }, token);
    return;
  }

  throw new Error("ACTIVE_CREATIVE_NO_SPEC");
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
    limit: "20",
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

// Extrai o número WhatsApp do criativo do primeiro anúncio de um conjunto.
// Esse número é o mesmo que aparece nos anúncios ativos — fonte mais confiável.
async function fetchWhatsappNumberFromAdSet(adSetId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/${adSetId}/ads?fields=creative{object_story_spec}&limit=1&access_token=${encodeURIComponent(token)}`
    );
    const json = (await res.json()) as {
      data?: Array<{ creative?: { object_story_spec?: { link_data?: { link?: string; call_to_action?: { value?: { whatsapp_number?: string } } } } } }>;
    };
    const linkData = json.data?.[0]?.creative?.object_story_spec?.link_data;
    if (!linkData) return null;

    // Caminho 1: call_to_action.value.whatsapp_number
    const ctaNum = linkData.call_to_action?.value?.whatsapp_number;
    if (ctaNum) return `+${ctaNum.replace(/\D/g, "")}`;

    // Caminho 2: link wa.me/551199999999
    const waMatch = (linkData.link ?? "").match(/wa\.me\/(\d+)/);
    if (waMatch) return `+${waMatch[1]}`;

    return null;
  } catch {
    return null;
  }
}

// Busca o número WhatsApp Business vinculado à Página via API da Meta.
async function fetchPageWhatsappNumber(pageId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/${pageId}?fields=whatsapp_number&access_token=${encodeURIComponent(token)}`
    );
    const json = (await res.json()) as { whatsapp_number?: string; error?: unknown };
    if (!json.whatsapp_number) return null;
    return `+${json.whatsapp_number.replace(/\D/g, "")}`;
  } catch {
    return null;
  }
}

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

function formatMetaError(e: MetaApiError): string {
  const parts = [e.message];
  if (e.error_user_title) parts.push(`— ${e.error_user_title}`);
  if (e.error_user_msg) parts.push(`| ${e.error_user_msg}`);
  if (e.code) parts.push(`[code ${e.code}${e.error_subcode ? `.${e.error_subcode}` : ""}]`);
  if (e.fbtrace_id) parts.push(`(trace: ${e.fbtrace_id})`);
  return parts.join(" ");
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
    throw new Error(formatMetaError(json.error));
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
    throw new Error(formatMetaError(json.error));
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
      "Erro Meta (#3) ‘Application does not have the capability’: o token salvo pode ser de um app diferente do configurado no sistema. Gere um novo token no Graph API Explorer com o app correto (gestor-trafego-triad) e salve em Configurações."
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
    `${BASE_URL}/${campaignId}/adsets?fields=id,name,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,bid_amount,targeting,destination_type,promoted_object,instagram_actor_id&limit=50&access_token=${encodeURIComponent(token)}`
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
      instagram_actor_id?: string;
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
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
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
    // Público Advantage sempre desabilitado
    targeting.targeting_automation = { advantage_audience: 0 };

    // ── Compatibilidade objetivo × meta de desempenho ──────────
    const effectiveDestinationType = adSet.destination_type ?? "";

    const optimizationGoal = "CONVERSATIONS";
    const billingEvent = "IMPRESSIONS";

    const adSetParams: Record<string, string> = {
      name: adSet.name,
      campaign_id: newCampaignId,
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      targeting: JSON.stringify(targeting),
      status: "PAUSED",
      access_token: token,
    };

    if (effectiveDestinationType) adSetParams.destination_type = effectiveDestinationType;
    if (adSet.instagram_actor_id) adSetParams.instagram_actor_id = adSet.instagram_actor_id;

    // whatsapp_phone_number é obrigatório no promoted_object para destino WHATSAPP (error 100.2446885).
    // Prioridade: promoted_object original → cadastro do cliente → criativo do primeiro anúncio.
    if (adSet.promoted_object || effectiveDestinationType === "WHATSAPP") {
      const po: Record<string, string> = { ...(adSet.promoted_object ?? {}) };

      if (effectiveDestinationType === "WHATSAPP" && !po.whatsapp_phone_number) {
        // Tenta extrair do criativo do primeiro anúncio do conjunto original
        const waFromCreative = await fetchWhatsappNumberFromAdSet(adSet.id, token);
        const resolved = whatsappNumber ?? waFromCreative;
        if (resolved) po.whatsapp_phone_number = resolved;
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

      // Busca o creative_id do anúncio original (evita /copies que exige permissão extra)
      const adDetailRes = await fetch(
        `${BASE_URL}/${ad.id}?fields=creative&access_token=${encodeURIComponent(token)}`
      );
      const adDetailJson = (await adDetailRes.json()) as {
        creative?: { id: string };
        error?: MetaApiError;
      };
      if (adDetailJson.error) throw new Error(formatMetaError(adDetailJson.error));
      const creativeId = adDetailJson.creative?.id;
      if (!creativeId) throw new Error(`Criativo não encontrado para o anúncio "${ad.name}"`);

      await postMeta(`${adAccountId}/ads`, {
        name: ad.name,
        adset_id: newAdSetId,
        creative: JSON.stringify({ creative_id: creativeId }),
        status: "PAUSED",
        access_token: token,
      });
    }
  }

  return newCampaignId;
}

export interface CampaignPrefillData {
  name: string;
  objective: string;
  dailyBudget: number;
  pageId: string;
  whatsappNumber: string;
  instagramActorId?: string;
  adsetId?: string;
  adId?: string;
  ageMin: number;
  ageMax: number;
  genderMode: "all" | "male" | "female";
  locations: SelectedLocation[];
  interests: MetaInterest[];
  platforms: { facebook: boolean; instagram: boolean };
  fbPositions: string[];
  igPositions: string[];
  primaryText: string;
  headline: string;
  description: string;
  mediaType: "image" | "video";
  videoId?: string;
  imageHash?: string;
  thumbnailUrl?: string;
}

export async function fetchBaseCampaignPrefill(
  campaignId: string,
  token: string
): Promise<CampaignPrefillData> {
  // Campaign
  const campRes = await fetch(
    `${BASE_URL}/${campaignId}?fields=name,objective,daily_budget&access_token=${encodeURIComponent(token)}`
  );
  const campJson = (await campRes.json()) as {
    name?: string;
    objective?: string;
    daily_budget?: string;
    error?: MetaApiError;
  };
  if (campJson.error) throw new Error(formatMetaError(campJson.error));

  // First adset
  const asRes = await fetch(
    `${BASE_URL}/${campaignId}/adsets?fields=targeting,promoted_object,instagram_actor_id,daily_budget&limit=1&access_token=${encodeURIComponent(token)}`
  );
  const asJson = (await asRes.json()) as {
    data?: Array<{
      id: string;
      targeting?: MetaTargeting;
      promoted_object?: { page_id?: string; whatsapp_phone_number?: string };
      instagram_actor_id?: string;
      daily_budget?: string;
    }>;
    error?: MetaApiError;
  };
  if (asJson.error) throw new Error(formatMetaError(asJson.error));
  const adSet = asJson.data?.[0];
  const targeting = adSet?.targeting;

  // First ad of that adset
  let primaryText = "";
  let headline = "";
  let description = "";
  let videoId: string | undefined;
  let imageHash: string | undefined;
  let thumbnailUrl: string | undefined;
  let mediaType: "image" | "video" = "image";
  let resolvedAdId: string | undefined;

  if (adSet) {
    const adsRes = await fetch(
      `${BASE_URL}/${adSet.id}/ads?fields=id&limit=1&access_token=${encodeURIComponent(token)}`
    );
    const adsJson = (await adsRes.json()) as { data?: Array<{ id: string }> };
    const adId = adsJson.data?.[0]?.id;
    if (adId) {
      resolvedAdId = adId;
      try {
        const cr = await fetchAdWithCreative(adId, token);
        primaryText = cr.body ?? cr.object_story_spec?.video_data?.message ?? cr.object_story_spec?.link_data?.message ?? "";
        headline = cr.title ?? cr.object_story_spec?.video_data?.title ?? cr.object_story_spec?.link_data?.name ?? "";
        description = cr.description ?? "";
        thumbnailUrl = cr.thumbnail_url ?? undefined;
        videoId = cr.video_id ?? cr.object_story_spec?.video_data?.video_id;
        imageHash = cr.object_story_spec?.link_data?.image_hash;
        mediaType = videoId ? "video" : "image";
      } catch { /* silent — creative fields are bonus */ }
    }
  }

  // Targeting fields
  const t = targeting;
  const genders = t?.genders;
  const genderMode: "all" | "male" | "female" =
    genders?.includes(1) && !genders.includes(2) ? "male"
    : genders?.includes(2) && !genders.includes(1) ? "female"
    : "all";

  const cities = (t?.geo_locations?.cities ?? []).map((c) => ({
    key: c.key,
    name: c.key,
    type: "city" as const,
    radius: (c as { radius?: number }).radius,
  }));
  const rawRegions = ((t?.geo_locations as Record<string, unknown> | undefined)?.["regions"] as Array<{ key: string }> | undefined) ?? [];
  const regions = rawRegions.map((r) => ({
    key: r.key,
    name: r.key,
    type: "region" as const,
  }));
  const locations: SelectedLocation[] = [...cities, ...regions];

  const interests: MetaInterest[] = (t?.flexible_spec?.[0]?.interests ?? []).map((i) => ({
    id: String(i.id),
    name: i.name,
  }));

  const fbPlaces = t?.facebook_positions ?? [];
  const igPlaces = t?.instagram_positions ?? [];
  const platforms = {
    facebook: (t?.publisher_platforms ?? ["facebook"]).includes("facebook"),
    instagram: (t?.publisher_platforms ?? ["instagram"]).includes("instagram"),
  };

  const dailyBudgetCents =
    campJson.daily_budget ? parseInt(campJson.daily_budget, 10) : (adSet?.daily_budget ? parseInt(adSet.daily_budget, 10) : 5000);

  return {
    name: campJson.name ?? "",
    objective: campJson.objective ?? "OUTCOME_ENGAGEMENT",
    dailyBudget: dailyBudgetCents / 100,
    pageId: adSet?.promoted_object?.page_id ?? "",
    whatsappNumber: adSet?.promoted_object?.whatsapp_phone_number ?? "",
    instagramActorId: adSet?.instagram_actor_id,
    adsetId: adSet?.id,
    adId: resolvedAdId,
    ageMin: t?.age_min ?? 18,
    ageMax: t?.age_max ?? 65,
    genderMode,
    locations,
    interests,
    platforms,
    fbPositions: fbPlaces.length > 0 ? fbPlaces : ["feed", "story"],
    igPositions: igPlaces.filter((p) => p !== "ig_search").length > 0
      ? igPlaces.filter((p) => p !== "ig_search")
      : ["stream", "story"],
    primaryText,
    headline,
    description,
    mediaType,
    videoId,
    imageHash,
    thumbnailUrl,
  };
}

export interface CreateFromScratchOptions {
  name: string;
  adAccountId: string;
  pageId: string;
  whatsappNumber?: string;
  dailyBudget: number; // BRL
  placements: { facebook: boolean; instagram: boolean };
  fbPositions?: string[];
  igPositions?: string[];
  token: string;
  campaignType?: "engagement" | "sales";
  instagramActorId?: string;
  targeting?: {
    ageMin?: number;
    ageMax?: number;
    genderMode?: "all" | "male" | "female";
    locations?: SelectedLocation[];
    interests?: MetaInterest[];
  };
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
    daily_budget: String(Math.round(opts.dailyBudget * 100)),
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    access_token: opts.token,
  }) as { id: string };

  const campaignId = campaign.id;

  const publisher_platforms: string[] = [];
  const facebook_positions: string[] = [];
  const instagram_positions: string[] = [];

  if (opts.placements.facebook) {
    publisher_platforms.push("facebook");
    facebook_positions.push(...(opts.fbPositions?.length ? opts.fbPositions : ["feed", "story"]));
  }
  if (opts.placements.instagram) {
    publisher_platforms.push("instagram");
    instagram_positions.push(...(opts.igPositions?.length ? opts.igPositions : ["stream", "story"]));
    // explore_home requires explore (Meta rule)
    if (instagram_positions.includes("explore_home") && !instagram_positions.includes("explore")) {
      instagram_positions.push("explore");
    }
    // ig_search conflicts with other placements
    const igSearchIdx = instagram_positions.indexOf("ig_search");
    if (igSearchIdx !== -1) instagram_positions.splice(igSearchIdx, 1);
  }

  const t = opts.targeting;
  let geoLocations: Record<string, unknown>;
  if (t?.locations?.length) {
    geoLocations = {};
    const cityLocs = t.locations.filter((l) => l.type === "city");
    const regionLocs = t.locations.filter((l) => l.type !== "city");
    if (cityLocs.length) {
      geoLocations.cities = cityLocs.map((l) => ({
        key: l.key,
        ...(l.radius ? { radius: l.radius, distance_unit: "kilometer" } : {}),
      }));
    }
    if (regionLocs.length) {
      geoLocations.regions = regionLocs.map((l) => ({ key: l.key }));
    }
  } else {
    geoLocations = { countries: ["BR"] };
  }
  const targeting: Record<string, unknown> = { geo_locations: geoLocations };
  if (t?.ageMin !== undefined && t.ageMin > 18) targeting.age_min = t.ageMin;
  if (t?.ageMax !== undefined && t.ageMax < 65) targeting.age_max = t.ageMax;
  if (t?.genderMode === "male") targeting.genders = [1];
  else if (t?.genderMode === "female") targeting.genders = [2];
  if (t?.interests?.length) targeting.flexible_spec = [{ interests: t.interests }];
  if (publisher_platforms.length) targeting.publisher_platforms = publisher_platforms;
  if (facebook_positions.length) targeting.facebook_positions = facebook_positions;
  if (instagram_positions.length) targeting.instagram_positions = instagram_positions;
  // Público Advantage sempre desabilitado
  targeting.targeting_automation = { advantage_audience: 0 };

  // whatsapp_phone_number é obrigatório no promoted_object para destination_type=WHATSAPP (error 100.2446885).
  // whatsapp_phone_number obrigatório para destino WHATSAPP.
  // Na criação do zero, vem do cadastro do cliente (meta_whatsapp_number).
  if (!opts.whatsappNumber) {
    throw new Error(
      "Número WhatsApp Business não cadastrado para este cliente. Edite o cliente em Configurações e preencha o campo \"WhatsApp Business (+55...)\"."
    );
  }

  // Meta expects phone without + prefix, spaces, or dashes (e.g. "559988215838")
  const normalizedPhone = opts.whatsappNumber.replace(/\D/g, "");
  const promotedObject: Record<string, string> = {
    page_id: opts.pageId,
    whatsapp_phone_number: normalizedPhone,
  };
  const destinationType = "WHATSAPP";

  const adSetPayload: Record<string, string> = {
    name: opts.name,
    campaign_id: campaignId,
    billing_event: "IMPRESSIONS",
    optimization_goal: "CONVERSATIONS",
    destination_type: destinationType,
    promoted_object: JSON.stringify(promotedObject),
    targeting: JSON.stringify(targeting),
    status: "PAUSED",
    access_token: opts.token,
  };
  if (opts.instagramActorId) adSetPayload.instagram_actor_id = opts.instagramActorId;

  const adSet = await postMeta(`${opts.adAccountId}/adsets`, adSetPayload) as { id: string };

  return { campaignId, adSetId: adSet.id };
}

// ── Ad media upload ───────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadAdImage(adAccountId: string, file: File, token: string): Promise<string> {
  const base64 = await fileToBase64(file);
  const formData = new FormData();
  formData.append("bytes", base64);
  formData.append("filename", file.name);
  formData.append("access_token", token);

  const res = await fetch(`${BASE_URL}/${adAccountId}/adimages`, { method: "POST", body: formData });
  const json = (await res.json()) as { images?: Record<string, { hash: string }>; error?: MetaApiError };
  if (json.error) {
    await recordMetaApiError(`${adAccountId}/adimages`, res.status, json.error);
    throw new Error(formatMetaError(json.error));
  }
  const firstImage = Object.values(json.images ?? {})[0];
  if (!firstImage?.hash) throw new Error("Upload de imagem falhou: hash não retornado pela Meta.");
  return firstImage.hash;
}

export async function uploadAdVideo(adAccountId: string, file: File, token: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("access_token", token);

  const res = await fetch(`${BASE_URL}/${adAccountId}/advideos`, { method: "POST", body: formData });
  const json = (await res.json()) as { id?: string; error?: MetaApiError };
  if (json.error) {
    await recordMetaApiError(`${adAccountId}/advideos`, res.status, json.error);
    throw new Error(formatMetaError(json.error));
  }
  if (!json.id) throw new Error("Upload de vídeo falhou: ID não retornado pela Meta.");
  return json.id;
}

// ── Ad creative & ad creation ─────────────────────────────────

export interface AdCreativeOptions {
  name: string;
  pageId: string;
  whatsappNumber: string; // digits only, e.g. "559988215838"
  whatsappMessage?: string;
  primaryText: string;
  headline: string;
  description?: string;
  mediaType: "image" | "video";
  imageHash?: string;
  videoId?: string;
  thumbnailUrl?: string; // existing thumbnail for video creatives (e.g. from duplicate flow)
}

export async function createAdCreative(
  adAccountId: string,
  opts: AdCreativeOptions,
  token: string
): Promise<string> {
  const waLink = opts.whatsappMessage
    ? `https://wa.me/${opts.whatsappNumber}?text=${encodeURIComponent(opts.whatsappMessage)}`
    : `https://wa.me/${opts.whatsappNumber}`;

  const callToAction = {
    type: "WHATSAPP_MESSAGE",
    value: { app_destination: "WHATSAPP", whatsapp_number: opts.whatsappNumber },
  };

  const objectStorySpec =
    opts.mediaType === "image"
      ? {
          page_id: opts.pageId,
          link_data: {
            image_hash: opts.imageHash,
            message: opts.primaryText,
            name: opts.headline,
            ...(opts.description ? { description: opts.description } : {}),
            link: waLink,
            call_to_action: callToAction,
          },
        }
      : {
          page_id: opts.pageId,
          video_data: {
            video_id: opts.videoId,
            message: opts.primaryText,
            title: opts.headline,
            ...(opts.description ? { description: opts.description } : {}),
            ...(opts.thumbnailUrl ? { image_url: opts.thumbnailUrl } : {}),
            call_to_action: callToAction,
          },
        };

  const result = (await postMeta(`${adAccountId}/adcreatives`, {
    name: opts.name,
    object_story_spec: JSON.stringify(objectStorySpec),
    access_token: token,
  })) as { id: string };

  return result.id;
}

export async function createAd(
  adAccountId: string,
  opts: { name: string; adSetId: string; creativeId: string },
  token: string
): Promise<string> {
  const result = (await postMeta(`${adAccountId}/ads`, {
    name: opts.name,
    adset_id: opts.adSetId,
    creative: JSON.stringify({ creative_id: opts.creativeId }),
    status: "PAUSED",
    access_token: token,
  })) as { id: string };
  return result.id;
}
