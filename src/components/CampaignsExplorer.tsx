import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ArrowUp, ArrowDown, SlidersHorizontal, Check, X, Copy, Pencil, Scale, Search } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAllAdSets,
  fetchAllAds,
  getMetaToken,
  updateMetaObject,
  duplicateAdSet,
  duplicateAd,
  type MetaCampaign,
  type MetaAdSet,
  type MetaAd,
  type DatePreset,
  type CustomDateRange,
} from "@/lib/meta";
import { brl } from "@/lib/mock-data";
import { statusTextClass } from "@/lib/status-colors";
import {
  AVAILABLE_COLUMNS,
  COLUMN_LABELS,
  useColumnPrefs,
  type ColumnKey,
  type ExplorerLevel,
} from "@/lib/campaign-columns";

interface Row {
  id: string;
  name: string;
  status: string;
  campaign_id?: string;
  adset_id?: string;
  daily_budget: number | null;
  spend: number;
  leads: number;
  forms: number;
  cpl: number | null;
  impressions: number;
  link_clicks: number;
  ctr: number | null;
  cpm: number | null;
}

const METRIC_DIRECTION: Partial<Record<ColumnKey, "higher" | "lower">> = {
  cpl: "lower",
  cpm: "lower",
  leads: "higher",
  ctr: "higher",
};

function campaignToRow(c: MetaCampaign): Row {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    campaign_id: c.id,
    daily_budget: c.daily_budget,
    spend: c.spend,
    leads: c.leads,
    forms: c.forms,
    cpl: c.cpl,
    impressions: c.impressions,
    link_clicks: c.link_clicks,
    ctr: c.ctr,
    cpm: c.cpm,
  };
}

function adSetToRow(a: MetaAdSet): Row {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    campaign_id: a.campaign_id,
    daily_budget: a.daily_budget,
    spend: a.spend ?? 0,
    leads: a.leads ?? 0,
    forms: a.forms ?? 0,
    cpl: a.cpl ?? null,
    impressions: a.impressions ?? 0,
    link_clicks: a.link_clicks ?? 0,
    ctr: a.ctr ?? null,
    cpm: a.cpm ?? null,
  };
}

function adToRow(a: MetaAd): Row {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    campaign_id: a.campaign_id,
    adset_id: a.adset_id,
    daily_budget: null,
    spend: a.spend ?? 0,
    leads: a.leads ?? 0,
    forms: a.forms ?? 0,
    cpl: a.cpl ?? null,
    impressions: a.impressions ?? 0,
    link_clicks: a.link_clicks ?? 0,
    ctr: a.ctr ?? null,
    cpm: a.cpm ?? null,
  };
}

interface CampaignsExplorerProps {
  clientId: string;
  adAccountId: string;
  cplMax: number;
  whatsappNumber?: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  campaigns: MetaCampaign[];
  campaignsLoading: boolean;
  onOpenCampaign: (campaign: MetaCampaign, initialAdSetId?: string, initialAdId?: string) => void;
}

export function CampaignsExplorer({
  clientId,
  adAccountId,
  cplMax,
  whatsappNumber,
  datePreset,
  customRange,
  campaigns,
  campaignsLoading,
  onOpenCampaign,
}: CampaignsExplorerProps) {
  const [level, setLevel] = useState<ExplorerLevel>("campaign");
  const [search, setSearch] = useState("");
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<"name" | ColumnKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [compareOpen, setCompareOpen] = useState(false);
  const queryClient = useQueryClient();

  const toggleSort = (col: "name" | ColumnKey) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection(col === "name" || col === "status" ? "asc" : "desc");
    }
  };

  const { data: adSets = [], isLoading: adSetsLoading } = useQuery({
    queryKey: ["explorer-adsets", adAccountId, datePreset, customRange],
    queryFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      return fetchAllAdSets(adAccountId, token, datePreset, customRange);
    },
    enabled: level === "adset",
  });

  const { data: ads = [], isLoading: adsLoading } = useQuery({
    queryKey: ["explorer-ads", adAccountId, datePreset, customRange],
    queryFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      return fetchAllAds(adAccountId, token, datePreset, customRange);
    },
    enabled: level === "ad",
  });

  const hasFilter = selectedCampaignIds.size > 0;

  const rows: Row[] = useMemo(() => {
    let result: Row[];
    if (level === "campaign") {
      result = campaigns.map(campaignToRow);
    } else if (level === "adset") {
      const filtered = hasFilter ? adSets.filter((a) => a.campaign_id && selectedCampaignIds.has(a.campaign_id)) : adSets;
      result = filtered.map(adSetToRow);
    } else {
      const filtered = hasFilter ? ads.filter((a) => a.campaign_id && selectedCampaignIds.has(a.campaign_id)) : ads;
      result = filtered.map(adToRow);
    }
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((r) => r.name.toLowerCase().includes(q));
    return result;
  }, [level, campaigns, adSets, ads, hasFilter, selectedCampaignIds, search]);

  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortColumn as keyof Row] as number | string | null | undefined;
      const bv = b[sortColumn as keyof Row] as number | string | null | undefined;
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rows, sortColumn, sortDirection]);

  const isLoading = level === "campaign" ? campaignsLoading : level === "adset" ? adSetsLoading : adsLoading;

  const { columns, toggleColumn, moveColumn } = useColumnPrefs(level);

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ACTIVE" | "PAUSED" }) => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(id, { status }, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["explorer-adsets"] });
      queryClient.invalidateQueries({ queryKey: ["explorer-ads"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar status"),
  });

  const budgetMutation = useMutation({
    mutationFn: async ({ id, dailyBudget }: { id: string; dailyBudget: number }) => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(id, { daily_budget: String(Math.round(dailyBudget * 100)) }, token);
    },
    onSuccess: () => {
      toast.success("Orçamento atualizado.");
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["explorer-adsets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar orçamento"),
  });

  const duplicateAdSetMutation = useMutation({
    mutationFn: async (row: Row) => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      if (!row.campaign_id) throw new Error("Campanha do conjunto não encontrada");
      const newId = await duplicateAdSet(row.id, row.campaign_id, adAccountId, token, whatsappNumber);
      return { newId, campaignId: row.campaign_id };
    },
    onSuccess: ({ newId, campaignId }) => {
      toast.success("Conjunto duplicado.");
      queryClient.invalidateQueries({ queryKey: ["explorer-adsets"] });
      const c = campaigns.find((c) => c.id === campaignId);
      if (c) onOpenCampaign(c, newId);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao duplicar conjunto"),
  });

  const duplicateAdMutation = useMutation({
    mutationFn: async (row: Row) => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      if (!row.adset_id) throw new Error("Conjunto do anúncio não encontrado");
      const newId = await duplicateAd(row.id, row.adset_id, adAccountId, token);
      return { newId, campaignId: row.campaign_id, adSetId: row.adset_id };
    },
    onSuccess: ({ newId, campaignId, adSetId }) => {
      toast.success("Anúncio duplicado.");
      queryClient.invalidateQueries({ queryKey: ["explorer-ads"] });
      const c = campaigns.find((c) => c.id === campaignId);
      if (c) onOpenCampaign(c, adSetId, newId);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao duplicar anúncio"),
  });

  const nameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(id, { name }, token);
    },
    onSuccess: () => {
      toast.success("Nome atualizado.");
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["explorer-adsets"] });
      queryClient.invalidateQueries({ queryKey: ["explorer-ads"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao renomear"),
  });

  const toggleCampaignSelected = (id: string) => {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRowClick = (row: Row) => {
    if (level === "campaign") {
      const c = campaigns.find((c) => c.id === row.id);
      if (c) onOpenCampaign(c);
    } else if (level === "adset") {
      const c = campaigns.find((c) => c.id === row.campaign_id);
      if (c) onOpenCampaign(c, row.id);
    } else {
      const c = campaigns.find((c) => c.id === row.campaign_id);
      if (c) onOpenCampaign(c, row.adset_id, row.id);
    }
  };

  const showBudgetColumn = level !== "ad" && columns.includes("daily_budget");
  const orderedColumns = columns;

  const compareRows = useMemo(
    () => rows.filter((r) => selectedCampaignIds.has(r.id)),
    [rows, selectedCampaignIds],
  );

  const compareBestWorst = useMemo(() => {
    const result: Partial<Record<ColumnKey, { best: string | null; worst: string | null }>> = {};
    for (const col of orderedColumns) {
      const direction = METRIC_DIRECTION[col];
      if (!direction) continue;
      const values = compareRows
        .map((r) => ({ id: r.id, value: r[col as keyof Row] as number | null }))
        .filter((v): v is { id: string; value: number } => typeof v.value === "number");
      if (values.length < 2) continue;
      const best = direction === "higher"
        ? values.reduce((a, b) => (b.value > a.value ? b : a))
        : values.reduce((a, b) => (b.value < a.value ? b : a));
      const worst = direction === "higher"
        ? values.reduce((a, b) => (b.value < a.value ? b : a))
        : values.reduce((a, b) => (b.value > a.value ? b : a));
      if (best.id !== worst.id) {
        result[col] = { best: best.id, worst: worst.id };
      }
    }
    return result;
  }, [compareRows, orderedColumns]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <Tabs value={level} onValueChange={(v) => setLevel(v as ExplorerLevel)}>
          <TabsList>
            <TabsTrigger value="campaign">Campanhas</TabsTrigger>
            <TabsTrigger value="adset">
              Conjuntos{hasFilter ? ` (${selectedCampaignIds.size} sel.)` : ""}
            </TabsTrigger>
            <TabsTrigger value="ad">
              Anúncios{hasFilter ? ` (${selectedCampaignIds.size} sel.)` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {level === "campaign" && selectedCampaignIds.size >= 2 && (
            <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)} className="gap-1.5">
              <Scale className="h-3.5 w-3.5" />
              Comparar selecionadas ({selectedCampaignIds.size})
            </Button>
          )}
          <ColumnsPicker level={level} visible={columns} onToggle={toggleColumn} onMove={moveColumn} />
        </div>
      </div>

      <div className="relative mb-3 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Buscar ${level === "campaign" ? "campanha" : level === "adset" ? "conjunto" : "anúncio"}...`}
          className="pl-8 h-8 text-sm"
        />
      </div>

      <Card>
        <div className="overflow-x-auto overflow-y-auto max-h-[480px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="w-8">
                  {level === "campaign" && (
                    <Checkbox
                      checked={selectedCampaignIds.size > 0 && selectedCampaignIds.size === campaigns.length}
                      onCheckedChange={(checked) =>
                        setSelectedCampaignIds(checked ? new Set(campaigns.map((c) => c.id)) : new Set())
                      }
                    />
                  )}
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:text-foreground"
                  onClick={() => toggleSort("name")}
                >
                  {level === "campaign" ? "Campanha" : level === "adset" ? "Conjunto" : "Anúncio"}
                  {sortColumn === "name" && (sortDirection === "asc" ? " ↑" : " ↓")}
                </TableHead>
                {orderedColumns.map((col) => (
                  <TableHead
                    key={col}
                    className={`cursor-pointer select-none hover:text-foreground ${col === "status" ? "" : "text-right"}`}
                    onClick={() => toggleSort(col)}
                  >
                    {COLUMN_LABELS[col]}
                    {sortColumn === col && (sortDirection === "asc" ? " ↑" : " ↓")}
                  </TableHead>
                ))}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={orderedColumns.length + 3}><Skeleton className="h-5 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={orderedColumns.length + 3} className="text-center text-muted-foreground py-8 text-sm">
                    {search.trim()
                      ? "Nenhum resultado para a busca."
                      : level === "campaign"
                      ? "Nenhuma campanha encontrada para o período selecionado."
                      : hasFilter
                      ? "Nenhum item encontrado para as campanhas selecionadas."
                      : "Nenhum item encontrado para o período selecionado."}
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row) => (
                  <ExplorerRow
                    key={row.id}
                    row={row}
                    level={level}
                    columns={orderedColumns}
                    cplMax={cplMax}
                    selected={level === "campaign" && selectedCampaignIds.has(row.id)}
                    onToggleSelected={level === "campaign" ? () => toggleCampaignSelected(row.id) : undefined}
                    onClick={() => handleRowClick(row)}
                    onToggleStatus={() =>
                      statusMutation.mutate({ id: row.id, status: row.status === "ACTIVE" ? "PAUSED" : "ACTIVE" })
                    }
                    onSaveBudget={showBudgetColumn ? (value) => budgetMutation.mutate({ id: row.id, dailyBudget: value }) : undefined}
                    onSaveName={(name) => nameMutation.mutate({ id: row.id, name })}
                    clientId={clientId}
                    onDuplicateAdSet={level === "adset" ? () => duplicateAdSetMutation.mutate(row) : undefined}
                    onDuplicateAd={level === "ad" ? () => duplicateAdMutation.mutate(row) : undefined}
                    duplicating={
                      (level === "adset" && duplicateAdSetMutation.isPending && duplicateAdSetMutation.variables?.id === row.id) ||
                      (level === "ad" && duplicateAdMutation.isPending && duplicateAdMutation.variables?.id === row.id)
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Comparar campanhas selecionadas</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  {orderedColumns
                    .filter((col) => col !== "status")
                    .map((col) => (
                      <TableHead key={col} className="text-right">
                        {COLUMN_LABELS[col]}
                      </TableHead>
                    ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {compareRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{row.name}</TableCell>
                    {orderedColumns
                      .filter((col) => col !== "status")
                      .map((col) => {
                        const bw = compareBestWorst[col];
                        const isBest = bw?.best === row.id;
                        const isWorst = bw?.worst === row.id;
                        return (
                          <TableCell
                            key={col}
                            className={`text-right ${
                              isBest
                                ? "text-status-on-target font-semibold"
                                : isWorst
                                ? "text-status-critical"
                                : ""
                            }`}
                          >
                            {formatMetricValue(col, row)}
                            {isBest && (
                              <span className="ml-1.5 rounded-full bg-status-on-target/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-on-target">
                                melhor
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatMetricValue(col: ColumnKey, row: Row): string {
  switch (col) {
    case "daily_budget":
      return row.daily_budget !== null ? brl(row.daily_budget) : "—";
    case "spend":
      return row.spend > 0 ? brl(row.spend) : "—";
    case "leads":
      return row.leads > 0 || row.forms > 0 ? `${row.leads}${row.forms > 0 ? ` +${row.forms}f` : ""}` : "—";
    case "cpl":
      return row.cpl !== null ? brl(row.cpl) : "—";
    case "impressions":
      return row.impressions > 0 ? row.impressions.toLocaleString("pt-BR") : "—";
    case "link_clicks":
      return row.link_clicks > 0 ? row.link_clicks.toLocaleString("pt-BR") : "—";
    case "ctr":
      return row.ctr !== null ? `${row.ctr.toFixed(2)}%` : "—";
    case "cpm":
      return row.cpm !== null ? brl(row.cpm) : "—";
    default:
      return "—";
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card overflow-hidden mb-8">{children}</div>;
}

function ColumnsPicker({
  level,
  visible,
  onToggle,
  onMove,
}: {
  level: ExplorerLevel;
  visible: ColumnKey[];
  onToggle: (key: ColumnKey) => void;
  onMove: (key: ColumnKey, direction: "up" | "down") => void;
}) {
  const hidden = AVAILABLE_COLUMNS[level].filter((c) => !visible.includes(c));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Colunas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Visíveis</div>
        <div className="space-y-1 mb-3">
          {visible.map((col, i) => (
            <div key={col} className="flex items-center gap-2">
              <Checkbox checked onCheckedChange={() => onToggle(col)} />
              <span className="text-sm flex-1">{COLUMN_LABELS[col]}</span>
              <button
                onClick={() => onMove(col, "up")}
                disabled={i === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onMove(col, "down")}
                disabled={i === visible.length - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        {hidden.length > 0 && (
          <>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Ocultas</div>
            <div className="space-y-1">
              {hidden.map((col) => (
                <div key={col} className="flex items-center gap-2">
                  <Checkbox checked={false} onCheckedChange={() => onToggle(col)} />
                  <span className="text-sm text-muted-foreground">{COLUMN_LABELS[col]}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ExplorerRow({
  row,
  level,
  columns,
  cplMax,
  selected,
  onToggleSelected,
  onClick,
  onToggleStatus,
  onSaveBudget,
  onSaveName,
  clientId,
  onDuplicateAdSet,
  onDuplicateAd,
  duplicating,
}: {
  row: Row;
  level: ExplorerLevel;
  columns: ColumnKey[];
  cplMax: number;
  selected: boolean;
  onToggleSelected?: () => void;
  onClick: () => void;
  onToggleStatus: () => void;
  onSaveBudget?: (value: number) => void;
  onSaveName: (name: string) => void;
  clientId: string;
  onDuplicateAdSet?: () => void;
  onDuplicateAd?: () => void;
  duplicating?: boolean;
}) {
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(row.daily_budget ?? 0);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(row.name);
  const isActive = row.status === "ACTIVE";

  const cplColor =
    row.cpl === null
      ? ""
      : row.cpl <= cplMax
      ? statusTextClass["on-target"]
      : row.cpl <= cplMax * 1.3
      ? statusTextClass.attention
      : statusTextClass.critical;

  const renderCell = (col: ColumnKey) => {
    switch (col) {
      case "status":
        return (
          <Switch
            checked={isActive}
            onCheckedChange={() => onToggleStatus()}
            onClick={(e) => e.stopPropagation()}
          />
        );
      case "daily_budget":
        if (level === "ad") return "—";
        if (level === "campaign" && row.daily_budget === null) {
          return <span className="text-muted-foreground" title="Campanha usa orçamento por conjunto, não um valor único">Por conjunto</span>;
        }
        if (!onSaveBudget) return row.daily_budget !== null ? brl(row.daily_budget) : "—";
        return editingBudget ? (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Input
              type="number"
              value={budgetInput}
              onChange={(e) => setBudgetInput(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onSaveBudget(budgetInput); setEditingBudget(false); }
                if (e.key === "Escape") setEditingBudget(false);
              }}
              className="h-7 w-24 text-right"
              autoFocus
            />
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { onSaveBudget(budgetInput); setEditingBudget(false); }}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingBudget(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <button
            className="text-right w-full hover:underline"
            onClick={(e) => { e.stopPropagation(); setBudgetInput(row.daily_budget ?? 0); setEditingBudget(true); }}
          >
            {row.daily_budget !== null ? brl(row.daily_budget) : "definir"}
          </button>
        );
      case "spend":
        return row.spend > 0 ? brl(row.spend) : "—";
      case "leads":
        return row.leads > 0 || row.forms > 0 ? (
          <span>
            {row.leads > 0 ? row.leads : "—"}
            {row.forms > 0 && <span className="ml-1 text-xs text-muted-foreground">+{row.forms}f</span>}
          </span>
        ) : "—";
      case "cpl":
        return <span className={`font-medium ${cplColor}`}>{row.cpl !== null ? brl(row.cpl) : "—"}</span>;
      case "impressions":
        return row.impressions > 0 ? row.impressions.toLocaleString("pt-BR") : "—";
      case "link_clicks":
        return row.link_clicks > 0 ? row.link_clicks.toLocaleString("pt-BR") : "—";
      case "ctr":
        return row.ctr !== null ? `${row.ctr.toFixed(2)}%` : "—";
      case "cpm":
        return row.cpm !== null ? brl(row.cpm) : "—";
    }
  };

  return (
    <TableRow
      className={`cursor-pointer hover:bg-muted/50 transition-colors ${isActive ? "" : "opacity-50"}`}
      onClick={onClick}
    >
      <TableCell className="w-8">
        {level === "campaign" && onToggleSelected && (
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelected()} onClick={(e) => e.stopPropagation()} />
        )}
      </TableCell>
      <TableCell className="font-medium max-w-[220px]" onClick={(e) => editingName && e.stopPropagation()}>
        {editingName ? (
          <div className="flex items-center gap-1">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onSaveName(nameInput); setEditingName(false); }
                if (e.key === "Escape") { setNameInput(row.name); setEditingName(false); }
              }}
              className="h-7 text-sm"
              autoFocus
            />
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { onSaveName(nameInput); setEditingName(false); }}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { setNameInput(row.name); setEditingName(false); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 group">
            <span className="truncate" title={row.name}>{row.name}</span>
            <button
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setNameInput(row.name); setEditingName(true); }}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
      </TableCell>
      {columns.map((col) => (
        <TableCell key={col} className={col === "status" ? "" : "text-right tabular-nums"}>
          {renderCell(col)}
        </TableCell>
      ))}
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        {level === "campaign" ? (
          <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Duplicar campanha">
            <Link to="/campaigns/new" search={{ client: clientId, duplicateFrom: row.id, duplicateFromName: row.name }}>
              <Copy className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title={level === "adset" ? "Duplicar conjunto" : "Duplicar anúncio"}
            disabled={duplicating}
            onClick={level === "adset" ? onDuplicateAdSet : onDuplicateAd}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
