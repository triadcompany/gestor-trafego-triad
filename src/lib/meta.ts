import { supabase } from "./supabase";

const GRAPH_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ── Token storage ──────────────────────────────────────────────

export async function saveMetaToken(token: string, expiresAt: Date) {
  await supabase.from("app_config").upsert([
    { key: "meta_access_token", value: token },
    { key: "meta_token_expires_at", value: expiresAt.toISOString() },
  ]);
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
    supabase.from("app_config").upsert({ key: "last_synced_at", value: syncedAt }),
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

async function postMeta(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json() as { error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json;
}

export async function duplicateCampaign(
  campaignId: string,
  adAccountId: string,
  newName: string,
  token: string
): Promise<string> {
  // Step 1: copy campaign shell only (deep_copy at campaign level exceeds the 3-object limit)
  const copy = await postMeta(`${campaignId}/copies`, {
    ad_account_id: adAccountId,
    status_option: "PAUSED",
    access_token: token,
  }) as { copied_campaign_id: string };

  const newId = copy.copied_campaign_id;

  // Step 2: rename the new campaign
  await postMeta(newId, { name: newName, access_token: token });

  // Step 3: fetch original ad sets and copy each one individually
  // Each adset copy with deep_copy = adset + ad = 2 objects (within the < 3 limit)
  const adsetsRes = await fetch(
    `${BASE_URL}/${campaignId}/adsets?fields=id&access_token=${encodeURIComponent(token)}`
  );
  const adsetsJson = await adsetsRes.json() as {
    data?: Array<{ id: string }>;
    error?: { message: string };
  };
  if (adsetsJson.error) throw new Error(adsetsJson.error.message);

  for (const adset of adsetsJson.data ?? []) {
    await postMeta(`${adset.id}/copies`, {
      campaign_id: newId,
      deep_copy: "1",
      status_option: "PAUSED",
      access_token: token,
    });
  }

  return newId;
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
