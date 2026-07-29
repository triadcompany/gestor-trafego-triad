import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ArrowUp, ArrowDown, SlidersHorizontal, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAllAdSets,
  fetchAllAds,
  getMetaToken,
  updateMetaObject,
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
  adAccountId: string;
  cplMax: number;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  campaigns: MetaCampaign[];
  campaignsLoading: boolean;
  onOpenCampaign: (campaign: MetaCampaign, initialAdSetId?: string) => void;
}

export function CampaignsExplorer({
  adAccountId,
  cplMax,
  datePreset,
  customRange,
  campaigns,
  campaignsLoading,
  onOpenCampaign,
}: CampaignsExplorerProps) {
  const [level, setLevel] = useState<ExplorerLevel>("campaign");
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

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
    if (level === "campaign") return campaigns.map(campaignToRow);
    if (level === "adset") {
      const filtered = hasFilter ? adSets.filter((a) => a.campaign_id && selectedCampaignIds.has(a.campaign_id)) : adSets;
      return filtered.map(adSetToRow);
    }
    const filtered = hasFilter ? ads.filter((a) => a.campaign_id && selectedCampaignIds.has(a.campaign_id)) : ads;
    return filtered.map(adToRow);
  }, [level, campaigns, adSets, ads, hasFilter, selectedCampaignIds]);

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
    } else {
      const c = campaigns.find((c) => c.id === row.campaign_id);
      if (c) onOpenCampaign(c, level === "adset" ? row.id : undefined);
    }
  };

  const showBudgetColumn = level !== "ad" && columns.includes("daily_budget");
  const orderedColumns = columns;

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

        <ColumnsPicker level={level} visible={columns} onToggle={toggleColumn} onMove={moveColumn} />
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
                <TableHead>{level === "campaign" ? "Campanha" : level === "adset" ? "Conjunto" : "Anúncio"}</TableHead>
                {orderedColumns.map((col) => (
                  <TableHead key={col} className={col === "status" ? "" : "text-right"}>
                    {COLUMN_LABELS[col]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={orderedColumns.length + 2}><Skeleton className="h-5 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={orderedColumns.length + 2} className="text-center text-muted-foreground py-8 text-sm">
                    {level === "campaign"
                      ? "Nenhuma campanha encontrada para o período selecionado."
                      : hasFilter
                      ? "Nenhum item encontrado para as campanhas selecionadas."
                      : "Nenhum item encontrado para o período selecionado."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
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
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
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
}) {
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(row.daily_budget ?? 0);
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
      <TableCell className="font-medium max-w-[220px] truncate" title={row.name}>
        {row.name}
      </TableCell>
      {columns.map((col) => (
        <TableCell key={col} className={col === "status" ? "" : "text-right tabular-nums"}>
          {renderCell(col)}
        </TableCell>
      ))}
    </TableRow>
  );
}
