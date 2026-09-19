import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
} from "recharts";
import { Search, DollarSign, Check, CalendarRange, RefreshCw, ChevronRight, Play, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { fetchLeadAttributions, fetchLeadAttributionSummary, fetchLeadTimeHeatmap, fetchTopQualifiedLeadAds, markLeadQualified, retryQualifiedLeadEvent, convertLeadToSale, type LeadAttributionRow, type TopQualifiedLeadAd } from "@/server/lead-attribution";
import { fetchClientWhatsappInfo } from "@/lib/whatsapp-messages";
import { brl } from "@/lib/mock-data";
import type { DashboardPeriod } from "@/lib/queries";

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: "today",      label: "Hoje" },
  { value: "yesterday",  label: "Ontem" },
  { value: "last_3d",    label: "3 dias" },
  { value: "last_7d",    label: "7 dias" },
  { value: "last_30d",   label: "30 dias" },
  { value: "this_month", label: "Mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "maximum",    label: "Máximo" },
  { value: "custom",     label: "Período" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando",
  qualified: "Qualificado (não enviado)",
  conversion_sent: "Qualificado",
  conversion_failed: "Qualificado (falha ao enviar)",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  qualified: "secondary",
  conversion_sent: "default",
  conversion_failed: "destructive",
};

const QUALIFIED_STATUSES = new Set(["qualified", "conversion_sent", "conversion_failed"]);

const CHART_TOOLTIP_STYLE = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

// remote_jid vem tipo "5511987650009@s.whatsapp.net" — extrai só os dígitos e
// formata como número BR (com DDI) quando reconhece o padrão; senão mostra
// os dígitos crus com "+" na frente.
function formatPhoneFromJid(remoteJid: string): string {
  const digits = remoteJid.split("@")[0].replace(/\D/g, "");
  const match = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (match) {
    const [, ddd, prefix, suffix] = match;
    return `+55 (${ddd}) ${prefix}-${suffix}`;
  }
  return digits ? `+${digits}` : remoteJid;
}

export function LeadsDashboard({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [saleFor, setSaleFor] = useState<LeadAttributionRow | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>("maximum");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");

  const customRange = period === "custom" && customSince && customUntil ? { since: customSince, until: customUntil } : undefined;
  const periodReady = period !== "custom" || !!customRange;

  const { data: whatsappInfo } = useQuery({
    queryKey: ["client-whatsapp-info", clientId],
    queryFn: () => fetchClientWhatsappInfo(clientId),
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["lead-attribution-summary", clientId, period, customSince, customUntil],
    queryFn: () => fetchLeadAttributionSummary(clientId, period, customRange),
    enabled: periodReady,
  });
  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ["lead-attributions", clientId, period, customSince, customUntil],
    queryFn: () => fetchLeadAttributions(clientId, period, customRange),
    enabled: periodReady,
  });

  const qualifyMutation = useMutation({
    mutationFn: markLeadQualified,
    onSuccess: () => toast.success("Lead marcado como qualificado."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao marcar qualificado"),
    // Mesmo quando o envio pra Meta falha, o lead já foi marcado "qualified" ou
    // "conversion_failed" no banco — precisa recarregar pra mostrar isso e
    // liberar o botão "Reenviar", não só quando dá tudo certo.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-attributions", clientId] });
      queryClient.invalidateQueries({ queryKey: ["lead-attribution-summary", clientId] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: retryQualifiedLeadEvent,
    onSuccess: () => toast.success("Evento reenviado pra Meta com sucesso."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao reenviar evento"),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-attributions", clientId] });
      queryClient.invalidateQueries({ queryKey: ["lead-attribution-summary", clientId] });
    },
  });

  const invalidateAfterSale = () => {
    queryClient.invalidateQueries({ queryKey: ["lead-attributions", clientId] });
    queryClient.invalidateQueries({ queryKey: ["lead-attribution-summary", clientId] });
    queryClient.invalidateQueries({ queryKey: ["sales"] });
  };

  const filtered = leads.filter((l) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (l.contact_name ?? "").toLowerCase().includes(q) || l.remote_jid.includes(q);
  });

  const trendData = useMemo(() => {
    const byDay = new Map<string, { leads: number; qualified: number }>();
    for (const lead of leads) {
      const key = lead.first_message_at.slice(0, 10);
      const entry = byDay.get(key) ?? { leads: 0, qualified: 0 };
      entry.leads++;
      if (lead.sale_id || QUALIFIED_STATUSES.has(lead.status)) entry.qualified++;
      byDay.set(key, entry);
    }
    const days: { key: string; label: string; leads: number; qualified: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = byDay.get(key) ?? { leads: 0, qualified: 0 };
      days.push({ key, label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), ...entry });
    }
    return days;
  }, [leads]);

  const funnelData = useMemo(() => {
    let converted = 0;
    let qualified = 0;
    let pending = 0;
    for (const lead of leads) {
      if (lead.sale_id) converted++;
      else if (QUALIFIED_STATUSES.has(lead.status)) qualified++;
      else pending++;
    }
    return [
      { name: "Aguardando", value: pending, color: "var(--chart-5)" },
      { name: "Qualificado", value: qualified, color: "var(--chart-2)" },
      { name: "Convertido", value: converted, color: "var(--primary)" },
    ].filter((d) => d.value > 0);
  }, [leads]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground pt-1.5">
          {whatsappInfo?.connectedAt
            ? `WhatsApp conectado em ${new Date(whatsappInfo.connectedAt).toLocaleDateString("pt-BR")}${whatsappInfo.instanceLabel ? ` (${whatsappInfo.instanceLabel})` : ""}`
            : "Nenhuma instância de WhatsApp vinculada a este cliente."}
        </p>
        <div className="flex flex-col items-end gap-1.5">
          <div
            role="group"
            aria-label="Selecionar período"
            className="flex flex-wrap rounded-md border border-border overflow-hidden text-xs"
          >
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPeriod(opt.value)}
                aria-pressed={period === opt.value}
                className={`flex items-center gap-1 px-3 py-1.5 touch-manipulation transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  period === opt.value
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {opt.value === "custom" && <CalendarRange className="h-3 w-3" />}
                {opt.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1.5 text-xs">
              <Input
                type="date"
                aria-label="Data inicial"
                value={customSince}
                onChange={(e) => setCustomSince(e.target.value)}
                className="h-7 w-32 text-xs px-2"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                aria-label="Data final"
                value={customUntil}
                onChange={(e) => setCustomUntil(e.target.value)}
                className="h-7 w-32 text-xs px-2"
              />
            </div>
          )}
        </div>
      </div>

      {summaryLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Conversas iniciadas"
            value={String(summary?.meta_conversations_started ?? 0)}
            hint="Gerenciador de Anúncios"
          />
          <StatCard
            label="Custo por conversa"
            value={summary?.cost_per_conversation != null ? brl(summary.cost_per_conversation) : "—"}
            hint="CCI"
          />
          <StatCard
            label="Leads"
            value={String(summary?.total_leads ?? 0)}
            hint="Chegou no WhatsApp"
          />
          <StatCard
            label="Custo por lead"
            value={summary?.cost_per_lead != null ? brl(summary.cost_per_lead) : "—"}
            hint="Lead de verdade"
          />
          <StatCard label="Qualificados" value={String(summary?.qualified_leads ?? 0)} />
          <StatCard label="Taxa de qualificação" value={summary?.qualification_rate !== null && summary?.qualification_rate !== undefined ? `${summary.qualification_rate}%` : "—"} />
          <StatCard label="Vendas" value={String(summary?.sales_count ?? 0)} />
          <StatCard label="Valor vendido" value={brl(summary?.sales_value_total ?? 0)} />
        </div>
      )}

      {!summaryLoading && summary && (
        <ConversionFunnel
          stages={[
            { label: "Conversas iniciadas", value: summary.meta_conversations_started },
            { label: "Leads", value: summary.total_leads },
            { label: "Leads qualificados", value: summary.qualified_leads },
            { label: "Vendas", value: summary.sales_count },
          ]}
        />
      )}

      <TimeHeatmap clientId={clientId} period={period} customRange={customRange} enabled={periodReady} />

      {!leadsLoading && leads.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="p-4 md:col-span-2">
            <p className="text-sm font-medium mb-3">Leads por dia (14 dias)</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(v: number, name: string) => [v, name === "leads" ? "Leads" : "Qualificados"]}
                  />
                  <Area type="monotone" dataKey="leads" stroke="var(--primary)" strokeWidth={2} fill="url(#leadsFill)" />
                  <Area type="monotone" dataKey="qualified" stroke="var(--chart-2)" strokeWidth={2} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-medium mb-3">Funil de status</p>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={funnelData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={62} paddingAngle={2} strokeWidth={0}>
                    {funnelData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <ChartTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-1.5 mt-2">
              {funnelData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="flex-1">{d.name}</span>
                  <span className="font-mono tabular-nums text-foreground">{d.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone..." className="pl-8 h-9" />
        </div>
      </div>

      <Card className="overflow-hidden">
        {leadsLoading ? (
          <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">
            {leads.length === 0 ? "Nenhum lead atribuído ainda. Conversas novas do WhatsApp vindas de um anúncio Click-to-WhatsApp aparecem aqui." : `Nenhum lead encontrado para "${search}".`}
          </p>
        ) : (
          // Altura fixa (~10 linhas) com rolagem interna — a tabela pode ter
          // centenas de leads e não faz sentido esticar a página inteira.
          <div className="overflow-auto max-h-[640px]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Campanha / Conjunto / Anúncio</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Venda</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(lead.first_message_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-sm">{lead.contact_name || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">{formatPhoneFromJid(lead.remote_jid)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[240px]">
                    <p className="truncate">{lead.campaign_name ?? "—"}</p>
                    <p className="truncate">{lead.adset_name ?? ""}</p>
                    <p className="truncate">{lead.ad_name ?? ""}</p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANT[lead.status]}
                      className="text-[10px]"
                      title={lead.status === "conversion_failed" || lead.status === "qualified" ? lead.conversion_error ?? undefined : undefined}
                    >
                      {STATUS_LABEL[lead.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {lead.sale_id ? (
                      <span className="text-status-on-target font-medium">{lead.sale_value !== null ? brl(lead.sale_value) : "Vendido"}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {lead.status === "pending" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mr-1.5" onClick={() => qualifyMutation.mutate(lead.id)} disabled={qualifyMutation.isPending}>
                        <Check className="h-3 w-3" /> Qualificar
                      </Button>
                    )}
                    {(lead.status === "conversion_failed" || lead.status === "qualified") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 mr-1.5"
                        onClick={() => retryMutation.mutate(lead.id)}
                        disabled={retryMutation.isPending}
                        title={lead.conversion_error ?? undefined}
                      >
                        <RefreshCw className="h-3 w-3" /> Reenviar
                      </Button>
                    )}
                    {!lead.sale_id && (
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setSaleFor(lead)}>
                        <DollarSign className="h-3 w-3" /> Converter
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </Card>

      <TopQualifiedAdsCard clientId={clientId} period={period} customRange={customRange} enabled={periodReady} />

      <ConvertToSaleDialog lead={saleFor} onClose={() => setSaleFor(null)} onSuccess={invalidateAfterSale} />
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      <p className="text-xl font-semibold tabular-nums truncate">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-1">{hint}</p>}
    </Card>
  );
}

// Funil horizontal: largura de cada etapa é fixa (colunas iguais), a altura
// do "cano" que afunila comunica a queda de volume entre etapas — com um piso
// mínimo pra etapas pequenas não sumirem visualmente. As porcentagens entre
// etapas ficam em selos sobre cada fronteira.
function ConversionFunnel({ stages }: { stages: { label: string; value: number }[] }) {
  const maxValue = Math.max(...stages.map((s) => s.value), 1);
  const minHeightPct = 26;
  const heights = stages.map((s) => minHeightPct + (100 - minHeightPct) * (s.value / maxValue));
  const opacities = [1, 0.78, 0.56, 0.36];

  return (
    <Card className="p-4">
      <p className="text-sm font-medium mb-4">Funil de conversão</p>
      <div className="relative h-24">
        <div className="absolute inset-0 flex">
          {stages.map((stage, i) => {
            const left = heights[i];
            const right = i < stages.length - 1 ? heights[i + 1] : heights[i];
            return (
              <div
                key={stage.label}
                className="flex-1"
                style={{
                  clipPath: `polygon(0% ${50 - left / 2}%, 100% ${50 - right / 2}%, 100% ${50 + right / 2}%, 0% ${50 + left / 2}%)`,
                  backgroundColor: "var(--primary)",
                  opacity: opacities[i] ?? 0.3,
                }}
              />
            );
          })}
        </div>
        {stages.slice(0, -1).map((stage, i) => {
          const next = stages[i + 1];
          const rate = stage.value > 0 ? Math.round((next.value / stage.value) * 1000) / 10 : null;
          const leftPct = ((i + 1) / stages.length) * 100;
          return (
            <div
              key={`rate-${stage.label}`}
              className="absolute top-1/2 flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 shadow-raised text-[11px] font-mono font-medium whitespace-nowrap"
              style={{ left: `${leftPct}%`, transform: "translate(-50%, -50%)" }}
            >
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              {rate !== null ? `${rate}%` : "—"}
            </div>
          );
        })}
      </div>
      <div className="flex mt-3">
        {stages.map((stage) => (
          <div key={stage.label} className="flex-1 text-center px-1">
            <p className="text-xs text-muted-foreground truncate">{stage.label}</p>
            <p className="text-base font-semibold tabular-nums">{stage.value.toLocaleString("pt-BR")}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Mapa de calor dia-da-semana x hora, versão desktop: todas as 24 colunas
// visíveis de uma vez (sem truncar em "Mais", como na versão mobile
// original) e os dias da semana como cabeçalho de linha.
function TimeHeatmap({
  clientId,
  period,
  customRange,
  enabled,
}: {
  clientId: string;
  period: DashboardPeriod;
  customRange?: { since: string; until: string };
  enabled: boolean;
}) {
  const [tab, setTab] = useState<"leads" | "sales">("leads");

  const { data: heatmap, isLoading } = useQuery({
    queryKey: ["lead-time-heatmap", clientId, period, customRange?.since, customRange?.until],
    queryFn: () => fetchLeadTimeHeatmap(clientId, period, customRange),
    enabled,
  });

  const grid = tab === "leads" ? heatmap?.leads : heatmap?.sales;
  const total = tab === "leads" ? heatmap?.totalLeads : heatmap?.totalSales;
  const maxCount = useMemo(() => {
    if (!grid) return 0;
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    return max;
  }, [grid]);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <p className="text-sm font-medium">
            {tab === "leads" ? "Horários que os leads mais entram em contato" : "Horários que as vendas mais acontecem"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Dia da semana x horário, horário de Brasília</p>
        </div>
        <div
          role="group"
          aria-label="Selecionar dado do mapa de calor"
          className="flex rounded-md border border-border overflow-hidden text-xs"
        >
          {(["leads", "sales"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setTab(opt)}
              aria-pressed={tab === opt}
              className={`px-3 py-1.5 touch-manipulation transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                tab === opt
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt === "leads" ? "Leads" : "Vendas"}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <Skeleton className="h-72 w-full" />}

      {!isLoading && (!grid || total === 0) && (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum dado no período selecionado.</p>
      )}

      {!isLoading && grid && total !== undefined && total > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[90px_repeat(24,minmax(0,1fr))] gap-[3px] mb-1">
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-center text-[10px] text-muted-foreground tabular-nums">
                  {h}
                </div>
              ))}
            </div>
            {grid.map((row, day) => (
              <div key={day} className="grid grid-cols-[90px_repeat(24,minmax(0,1fr))] gap-[3px] mb-[3px]">
                <div className="text-xs text-muted-foreground flex items-center pr-2 truncate">
                  {WEEKDAY_LABELS[day]}
                </div>
                {row.map((count, hour) => {
                  const intensity = maxCount > 0 ? count / maxCount : 0;
                  return (
                    <div
                      key={hour}
                      title={`${WEEKDAY_LABELS[day]}, ${hour}h: ${count}`}
                      className="aspect-square rounded-[3px] flex items-center justify-center text-[10px] font-medium tabular-nums"
                      style={{
                        backgroundColor:
                          count > 0
                            ? `color-mix(in oklch, var(--primary) ${Math.round(15 + intensity * 75)}%, var(--card))`
                            : "var(--muted)",
                        color: intensity > 0.5 ? "var(--primary-foreground)" : "var(--foreground)",
                      }}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && total !== undefined && total > 0 && (
        <p className="text-[11px] text-muted-foreground/70 mt-3">
          {tab === "leads" ? `Total leads: ${total.toLocaleString("pt-BR")}` : `Total vendas: ${total.toLocaleString("pt-BR")}`}
        </p>
      )}
    </Card>
  );
}

const RANK_LABEL = ["#1", "#2", "#3"];

// Ranking dos anúncios com lead qualificado mais barato — só entram anúncios
// com gasto registrado na Meta no período (sem gasto não dá pra calcular
// custo). O vídeo do criativo (quando existe) abre num modal; anúncio de
// imagem ou sem mídia recuperável cai no link "Ver no Facebook".
function TopQualifiedAdsCard({
  clientId,
  period,
  customRange,
  enabled,
}: {
  clientId: string;
  period: DashboardPeriod;
  customRange?: { since: string; until: string };
  enabled: boolean;
}) {
  const [videoAd, setVideoAd] = useState<TopQualifiedLeadAd | null>(null);

  const { data: ads, isLoading } = useQuery({
    queryKey: ["top-qualified-lead-ads", clientId, period, customRange?.since, customRange?.until],
    queryFn: () => fetchTopQualifiedLeadAds(clientId, period, customRange),
    enabled,
  });

  return (
    <Card className="p-4">
      <p className="text-sm font-medium">Top 3 anúncios — lead qualificado mais barato</p>
      <p className="text-xs text-muted-foreground mt-0.5 mb-4">
        Ranking pelo custo por lead qualificado (gasto do anúncio ÷ leads qualificados), não pelo custo por lead simples
      </p>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      )}

      {!isLoading && (!ads || ads.length === 0) && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nenhum anúncio com lead qualificado e gasto registrado no período.
        </p>
      )}

      {!isLoading && ads && ads.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {ads.map((ad, i) => (
            <div key={ad.ad_id} className="rounded-lg border border-border overflow-hidden flex flex-col">
              <button
                type="button"
                onClick={() => {
                  if (ad.video_url) setVideoAd(ad);
                  else if (ad.permalink_url) window.open(ad.permalink_url, "_blank", "noopener,noreferrer");
                }}
                disabled={!ad.video_url && !ad.permalink_url}
                className="relative aspect-video bg-muted flex items-center justify-center group disabled:cursor-default"
              >
                {ad.thumbnail_url ? (
                  <img src={ad.thumbnail_url} alt={ad.ad_name ?? "Anúncio"} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-muted-foreground">Sem prévia</span>
                )}
                {(ad.video_url || ad.permalink_url) && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <span className="h-9 w-9 rounded-full bg-white/90 flex items-center justify-center opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-transform">
                      {ad.video_url ? <Play className="h-4 w-4 text-black ml-0.5" fill="currentColor" /> : <ExternalLink className="h-4 w-4 text-black" />}
                    </span>
                  </span>
                )}
                <span className="absolute top-2 left-2 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold px-2 py-0.5">
                  {RANK_LABEL[i]}
                </span>
              </button>
              <div className="p-3 flex flex-col gap-1 flex-1">
                <p className="text-sm font-medium truncate" title={ad.ad_name ?? undefined}>{ad.ad_name ?? "Anúncio sem nome"}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {ad.campaign_name ?? "—"}{ad.adset_name ? ` · ${ad.adset_name}` : ""}
                </p>
                <div className="mt-auto pt-2 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Custo por lead qualificado</p>
                    <p className="text-base font-semibold tabular-nums">{brl(ad.cost_per_qualified_lead)}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-right">
                    {ad.qualified_count} qualificado{ad.qualified_count !== 1 ? "s" : ""}<br />
                    {brl(ad.spend)} gasto
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!videoAd} onOpenChange={(open) => !open && setVideoAd(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{videoAd?.ad_name ?? "Anúncio"}</DialogTitle>
          </DialogHeader>
          {videoAd?.video_url && (
            <video src={videoAd.video_url} controls autoPlay className="w-full rounded-md max-h-[70vh]" />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ConvertToSaleDialog({ lead, onClose, onSuccess }: { lead: LeadAttributionRow | null; onClose: () => void; onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [obs, setObs] = useState("");
  const [email, setEmail] = useState("");

  const mutation = useMutation({
    mutationFn: () => convertLeadToSale(lead!.id, value.trim() ? Number(value) : null, obs, email),
    onSuccess: () => {
      toast.success("Venda registrada.");
      setValue("");
      setObs("");
      setEmail("");
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar venda"),
  });

  return (
    <Dialog open={!!lead} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Lead: <span className="text-foreground font-medium">{lead?.contact_name || lead?.remote_jid.split("@")[0]}</span>
          </p>
          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input type="number" min={0} step={0.01} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Email do lead (opcional)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@email.com" />
            <p className="text-[11px] text-muted-foreground">Ajuda a Meta casar o evento com uma conta real — melhora a otimização (Event Match Quality).</p>
          </div>
          <div className="space-y-1.5">
            <Label>Observação (opcional)</Label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex: fechou o pacote premium" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando..." : "Registrar venda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
