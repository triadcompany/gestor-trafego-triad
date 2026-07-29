import { useEffect, useState } from "react";

export type ExplorerLevel = "campaign" | "adset" | "ad";

export type ColumnKey =
  | "status"
  | "daily_budget"
  | "spend"
  | "leads"
  | "cpl"
  | "impressions"
  | "link_clicks"
  | "ctr"
  | "cpm";

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  status: "Status",
  daily_budget: "Orçamento",
  spend: "Gasto",
  leads: "Leads",
  cpl: "CPL",
  impressions: "Impressões",
  link_clicks: "Cliques",
  ctr: "CTR",
  cpm: "CPM",
};

const CAMPAIGN_ADSET_COLUMNS: ColumnKey[] = [
  "status",
  "daily_budget",
  "spend",
  "leads",
  "cpl",
  "impressions",
  "link_clicks",
  "ctr",
  "cpm",
];

const AD_COLUMNS: ColumnKey[] = [
  "status",
  "spend",
  "leads",
  "cpl",
  "impressions",
  "link_clicks",
  "ctr",
  "cpm",
];

export const AVAILABLE_COLUMNS: Record<ExplorerLevel, ColumnKey[]> = {
  campaign: CAMPAIGN_ADSET_COLUMNS,
  adset: CAMPAIGN_ADSET_COLUMNS,
  ad: AD_COLUMNS,
};

const STORAGE_KEY_PREFIX = "campaigns-explorer-columns-";

function loadStoredColumns(level: ExplorerLevel): ColumnKey[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + level);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ColumnKey[];
    const available = new Set(AVAILABLE_COLUMNS[level]);
    const filtered = parsed.filter((c) => available.has(c));
    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

export function useColumnPrefs(level: ExplorerLevel) {
  const [columns, setColumns] = useState<ColumnKey[]>(
    () => loadStoredColumns(level) ?? AVAILABLE_COLUMNS[level]
  );

  useEffect(() => {
    setColumns(loadStoredColumns(level) ?? AVAILABLE_COLUMNS[level]);
  }, [level]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + level, JSON.stringify(columns));
  }, [level, columns]);

  const toggleColumn = (key: ColumnKey) => {
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  const moveColumn = (key: ColumnKey, direction: "up" | "down") => {
    setColumns((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  };

  return { columns, toggleColumn, moveColumn };
}
