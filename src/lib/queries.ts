import { supabase } from "./supabase";
import type { ClientStatus } from "./database.types";

export type { ClientStatus };

export interface ClientRow {
  id: string;
  name: string;
  meta_ad_account_id: string;
  meta_page_id: string | null;
  segment: "popular" | "premium";
  cpl_min: number;
  cpl_max: number;
  active: boolean;
  created_at: string;
}

export interface MetricRow {
  date: string;
  spend: number;
  leads: number;
  cpl: number | null;
}

export interface ClientWithToday extends ClientRow {
  status: ClientStatus;
  cplToday: number | null;
  spendToday: number;
  leadsToday: number;
}

export interface ClientDetail extends ClientRow {
  status: ClientStatus;
  cplToday: number | null;
  spendToday: number;
  leadsToday: number;
  history: MetricRow[];
}

function computeStatus(
  cpl: number | null,
  spend: number,
  cplMax: number
): ClientStatus {
  if (spend === 0) return "no-data";
  if (cpl === null) return "critical";
  if (cpl <= cplMax) return "on-target";
  if (cpl <= cplMax * 1.3) return "attention";
  return "critical";
}

export async function fetchClients(): Promise<ClientWithToday[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) throw error;

  const { data: metrics } = await supabase
    .from("metrics_daily")
    .select("client_id, spend, leads, cpl")
    .eq("date", today);

  const metricsMap = new Map(
    (metrics ?? []).map((m) => [m.client_id, m])
  );

  return clients.map((c) => {
    const m = metricsMap.get(c.id);
    const spend = m?.spend ?? 0;
    const leads = m?.leads ?? 0;
    const cpl = m?.cpl ?? null;
    return {
      ...c,
      spendToday: spend,
      leadsToday: leads,
      cplToday: cpl,
      status: computeStatus(cpl, spend, c.cpl_max),
    };
  });
}

export async function fetchAllClients(): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name");
  if (error) throw error;
  return data;
}

export async function fetchClientDetail(id: string): Promise<ClientDetail> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [{ data: client, error }, { data: history }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("metrics_daily")
      .select("date, spend, leads, cpl")
      .eq("client_id", id)
      .gte("date", thirtyDaysAgo)
      .order("date"),
  ]);

  if (error || !client) throw error ?? new Error("Cliente não encontrado");

  const todayMetric = (history ?? []).find((m) => m.date === today);
  const spend = todayMetric?.spend ?? 0;
  const leads = todayMetric?.leads ?? 0;
  const cpl = todayMetric?.cpl ?? null;

  return {
    ...client,
    spendToday: spend,
    leadsToday: leads,
    cplToday: cpl,
    status: computeStatus(cpl, spend, client.cpl_max),
    history: history ?? [],
  };
}

export async function upsertClient(data: {
  id?: string;
  name: string;
  meta_ad_account_id: string;
  meta_page_id?: string;
  segment: "popular" | "premium";
  cpl_min: number;
  cpl_max: number;
}) {
  const { error } = await supabase.from("clients").upsert({
    ...data,
    active: true,
  });
  if (error) throw error;
}

export async function toggleClientActive(id: string, active: boolean) {
  const { error } = await supabase
    .from("clients")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
}

export async function updateClientGoal(
  id: string,
  cpl_min: number,
  cpl_max: number
) {
  const { error } = await supabase
    .from("clients")
    .update({ cpl_min, cpl_max })
    .eq("id", id);
  if (error) throw error;
}
