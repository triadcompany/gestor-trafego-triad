import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ExternalLink, Pencil, Plus, Check, X, RefreshCw, TrendingUp, DollarSign, Users as UsersIcon } from "lucide-react";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { fetchClientDetail, updateClientGoal } from "@/lib/queries";
import { CampaignSheet } from "@/components/CampaignSheet";
import {
  fetchCampaigns,
  fetchDailyInsights,
  getMetaToken,
  type MetaCampaign,
  type DatePreset,
  type CustomDateRange,
} from "@/lib/meta";
import { brl } from "@/lib/mock-data";

export const Route = createFileRoute("/clients/$id")({
  head: () => ({
    meta: [{ title: "Cliente — Gestor de Tráfego" }],
  }),
  component: ClientDetail,
});

const DATE_PRESETS: { value: DatePreset | "custom"; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "this_week_mon_today", label: "Esta semana" },
  { value: "last_week_mon_sun", label: "Semana passada" },
  { value: "this_month", label: "Este mês" },
  { value: "maximum", label: "Máximo" },
  { value: "custom", label: "Personalizado" },
];

const PERIOD_LABELS: Record<DatePreset | "custom", string> = {
  today: "hoje",
  yesterday: "ontem",
  this_week_mon_today: "esta semana",
  last_week_mon_sun: "semana passada",
  this_month: "este mês",
  maximum: "todo o período",
  custom: "período personalizado",
};

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDateRange(preset: DatePreset | "custom", customSince: string, customUntil: string) {
  const today = new Date();
  const todayStr = fmt(today);

  switch (preset) {
    case "today":
      return { since: todayStr, until: todayStr };
    case "yesterday": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { since: fmt(d), until: fmt(d) };
    }
    case "this_week_mon_today": {
      const day = today.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const mon = new Date(today);
      mon.setDate(today.getDate() + diff);
      return { since: fmt(mon), until: todayStr };
    }
    case "last_week_mon_sun": {
      const day = today.getDay();
      const mon = new Date(today);
      mon.setDate(today.getDate() - (day === 0 ? 13 : day + 6));
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { since: fmt(mon), until: fmt(sun) };
    }
    case "this_month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { since: fmt(first), until: todayStr };
    }
    case "maximum":
      return { since: "2000-01-01", until: todayStr };
    case "custom":
      return { since: customSince, until: customUntil };
    default:
      return { since: todayStr, until: todayStr };
  }
}

function ClientDetail() {
  const { id } = useParams({ from: "/clients/$id" });
  const queryClient = useQueryClient();
  const [editingGoal, setEditingGoal] = useState(false);
  const [cplMin, setCplMin] = useState<number | null>(null);
  const [cplMax, setCplMax] = useState<number | null>(null);
  const [chartMetric, setChartMetric] = useState<"cpl" | "spend" | "leads">("cpl");
  const [selectedCampaign, setSelectedCampaign] = useState<MetaCampaign | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [datePreset, setDatePreset] = useState<DatePreset | "custom">("today");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", id],
    queryFn: () => fetchClientDetail(id),
  });

  const customRange: CustomDateRange | undefined =
    datePreset === "custom" && customSince && customUntil
      ? { since: customSince, until: customUntil }
      : undefined;

  const periodReady = datePreset !== "custom" || !!customRange;
  const metaPreset = datePreset === "custom" ? "today" : datePreset;

  const {
    data: insights = [],
    isLoading: insightsLoading,
  } = useQuery({
    queryKey: ["insights", id, datePreset, customSince, customUntil],
    queryFn: async () => {
      if (!client) return [];
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      return fetchDailyInsights(client.meta_ad_account_id, token, metaPreset, customRange);
    },
    enabled: !!client && periodReady,
  });

  const periodSpend = insights.reduce((s, h) => s + h.spend, 0);
  const periodLeads = insights.reduce((s, h) => s + h.leads, 0);
  const periodCpl =
    periodLeads > 0 ? Math.round((periodSpend / periodLeads) * 100) / 100 : null;

  const {
    data: campaigns,
    isLoading: campaignsLoading,
    refetch: refetchCampaigns,
    isRefetching: campaignsRefetching,
  } = useQuery({
    queryKey: ["campaigns", id, datePreset, customSince, customUntil],
    queryFn: async () => {
      if (!client) return [];
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      return fetchCampaigns(client.meta_ad_account_id, token, metaPreset, customRange);
    },
    enabled: !!client && periodReady,
  });

  const goalMin = cplMin ?? client?.cpl_min ?? 0;
  const goalMax = cplMax ?? client?.cpl_max ?? 0;

  const goalMutation = useMutation({
    mutationFn: () => updateClientGoal(id, goalMin, goalMax),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client", id] });
      queryClient.invalidateQueries({ queryKey: ["clients-dashboard"] });
      setEditingGoal(false);
      setCplMin(null);
      setCplMax(null);
    },
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </AppShell>
    );
  }

  if (!client) {
    return (
      <AppShell>
        <div className="p-8 text-center">
          <p className="text-muted-foreground">Cliente não encontrado.</p>
          <Link to="/" className="text-primary underline mt-2 inline-block">Voltar</Link>
        </div>
      </AppShell>
    );
  }

  const metaAdsUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${client.meta_ad_account_id.replace("act_", "")}`;
  const periodLabel = PERIOD_LABELS[datePreset];

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{client.name}</h1>
            <p className="text-sm text-muted-foreground mt-1 capitalize">
              {client.meta_ad_account_id} · {client.segment}
            </p>
          </div>

          {/* Period selector + Meta link */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset | "custom")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {datePreset === "custom" && (
              <>
                <Input
                  type="date"
                  value={customSince}
                  onChange={(e) => setCustomSince(e.target.value)}
                  className="h-9 text-sm w-36"
                />
                <span className="text-muted-foreground text-sm">–</span>
                <Input
                  type="date"
                  value={customUntil}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  className="h-9 text-sm w-36"
                />
              </>
            )}

            <Button variant="outline" size="sm" asChild>
              <a href={metaAdsUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Ver no Meta
              </a>
            </Button>
          </div>
        </div>

        {/* Meta CPL + métricas do período */}
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Meta de CPL</div>
              {editingGoal ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={goalMin}
                    onChange={(e) => setCplMin(Number(e.target.value))}
                    className="w-24"
                    min={0}
                    step={0.5}
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="number"
                    value={goalMax}
                    onChange={(e) => setCplMax(Number(e.target.value))}
                    className="w-24"
                    min={0}
                    step={0.5}
                  />
                  <Button size="icon" variant="ghost" onClick={() => goalMutation.mutate()} disabled={goalMutation.isPending}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { setEditingGoal(false); setCplMin(null); setCplMax(null); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-xl font-semibold tabular-nums">
                    {brl(client.cpl_min)} – {brl(client.cpl_max)}
                  </span>
                  <UITooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" onClick={() => setEditingGoal(true)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Editar meta de CPL</TooltipContent>
                  </UITooltip>
                </div>
              )}
            </div>
            <div className="flex gap-6">
              <Stat
                label={`CPL ${periodLabel}`}
                value={periodCpl !== null ? brl(periodCpl) : "—"}
              />
              <Stat label="Gasto" value={periodSpend > 0 ? brl(periodSpend) : "—"} />
              <Stat label="Leads" value={periodLeads > 0 ? String(periodLeads) : "—"} />
            </div>
          </div>
        </Card>

        {/* Gráfico */}
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-sm font-medium">
              {chartMetric === "cpl" ? "CPL" : chartMetric === "spend" ? "Gasto" : "Leads"} — {periodLabel}
            </h2>
            <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/30">
              {(
                [
                  { key: "cpl", icon: TrendingUp, label: "CPL" },
                  { key: "spend", icon: DollarSign, label: "Gasto" },
                  { key: "leads", icon: UsersIcon, label: "Leads" },
                ] as const
              ).map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onClick={() => setChartMetric(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    chartMetric === key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          {insightsLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : insights.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
              Sem dados para esse período.
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={insights.map((h) => ({ ...h, date: h.date.slice(5) }))}
                  margin={{ top: 5, right: 12, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={chartMetric === "leads" ? undefined : (v) => `R$${v}`} />
                  <ChartTooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => chartMetric === "leads" ? [v, "Leads"] : [brl(v), chartMetric === "cpl" ? "CPL" : "Gasto"]}
                  />
                  {chartMetric === "cpl" && (
                    <ReferenceArea y1={client.cpl_min} y2={client.cpl_max} fill="var(--primary)" fillOpacity={0.08} />
                  )}
                  <Line
                    type="monotone"
                    dataKey={chartMetric}
                    stroke={chartMetric === "cpl" ? "var(--primary)" : chartMetric === "spend" ? "hsl(var(--chart-2))" : "hsl(var(--chart-3))"}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Campanhas */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Campanhas</h2>
          <div className="flex items-center gap-2">
            <UITooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => refetchCampaigns()}
                  disabled={campaignsRefetching}
                >
                  <RefreshCw className={`h-4 w-4 ${campaignsRefetching ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Atualizar campanhas</TooltipContent>
            </UITooltip>
            <Button asChild size="sm" className="gap-2">
              <Link to="/campaigns/new" search={{ client: client.id }}>
                <Plus className="h-4 w-4" />
                Nova Campanha
              </Link>
            </Button>
          </div>
        </div>

        {campaigns && campaigns.length > 0 && (
          <CampaignsTotals campaigns={campaigns} cplMax={client.cpl_max} />
        )}

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orçamento/dia</TableHead>
                  <TableHead className="text-right">Gasto</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">Impressões</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaignsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={10}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : !campaigns || campaigns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8 text-sm">
                      Nenhuma campanha encontrada para o período selecionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  campaigns.map((c) => (
                    <CampaignRow
                      key={c.id}
                      campaign={c}
                      cplMax={client.cpl_max}
                      onClick={() => { setSelectedCampaign(c); setSheetOpen(true); }}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <CampaignSheet
        campaign={selectedCampaign}
        clientId={id}
        adAccountId={client.meta_ad_account_id}
        cplMax={client.cpl_max}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </AppShell>
  );
}

function CampaignsTotals({ campaigns, cplMax }: { campaigns: MetaCampaign[]; cplMax: number }) {
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leads, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.link_clicks, 0);

  const totalCpl = totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : null;
  const totalCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;
  const totalCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : null;

  const cplColor =
    totalCpl === null
      ? "text-foreground"
      : totalCpl <= cplMax
      ? "text-green-500"
      : totalCpl <= cplMax * 1.3
      ? "text-yellow-500"
      : "text-red-500";

  return (
    <Card className="p-3 mb-3 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        <span className="text-xs text-muted-foreground mr-3 shrink-0">
          {campaigns.length} campanhas
        </span>
        <TotalStat label="Gasto" value={brl(totalSpend)} />
        <Divider />
        <TotalStat label="Leads" value={totalLeads > 0 ? String(totalLeads) : "—"} />
        <Divider />
        <TotalStat label="CPL médio" value={totalCpl !== null ? brl(totalCpl) : "—"} valueClass={cplColor} />
        <Divider />
        <TotalStat label="Impressões" value={totalImpressions > 0 ? totalImpressions.toLocaleString("pt-BR") : "—"} />
        <Divider />
        <TotalStat label="Cliques" value={totalClicks > 0 ? totalClicks.toLocaleString("pt-BR") : "—"} />
        <Divider />
        <TotalStat label="CTR médio" value={totalCtr !== null ? `${totalCtr.toFixed(2)}%` : "—"} />
        <Divider />
        <TotalStat label="CPM médio" value={totalCpm !== null ? brl(totalCpm) : "—"} />
      </div>
    </Card>
  );
}

function TotalStat({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="px-3 text-center shrink-0">
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-8 bg-border shrink-0" />;
}

function CampaignRow({
  campaign: c,
  cplMax,
  onClick,
}: {
  campaign: MetaCampaign;
  cplMax: number;
  onClick: () => void;
}) {
  const isActive = c.status === "ACTIVE";

  const cplColor =
    c.cpl === null
      ? ""
      : c.cpl <= cplMax
      ? "text-green-500"
      : c.cpl <= cplMax * 1.3
      ? "text-yellow-500"
      : "text-red-500";

  return (
    <TableRow
      className={`cursor-pointer hover:bg-muted/50 transition-colors ${isActive ? "" : "opacity-50"}`}
      onClick={onClick}
    >
      <TableCell className="font-medium max-w-[220px] truncate" title={c.name}>
        {c.name}
      </TableCell>
      <TableCell>
        <Badge variant={isActive ? "default" : "secondary"}>
          {isActive ? "Ativa" : "Pausada"}
        </Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {c.daily_budget !== null ? brl(c.daily_budget) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {c.spend > 0 ? brl(c.spend) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {c.leads > 0 ? c.leads : "—"}
      </TableCell>
      <TableCell className={`text-right tabular-nums font-medium ${cplColor}`}>
        {c.cpl !== null ? brl(c.cpl) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {c.impressions > 0 ? c.impressions.toLocaleString("pt-BR") : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {c.link_clicks > 0 ? c.link_clicks.toLocaleString("pt-BR") : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {c.ctr !== null ? `${c.ctr.toFixed(2)}%` : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {c.cpm !== null ? brl(c.cpm) : "—"}
      </TableCell>
    </TableRow>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
