import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { getMetaToken, fetchTrafficInsights, type TrafficBreakdownRow } from "@/lib/meta";
import { isoDateInBrasilia, daysAgoInBrasilia, monthRangeInBrasilia } from "@/lib/brasilia-date";
import { brl } from "@/lib/mock-data";

type Preset = "7" | "15" | "30" | "mes" | "mes_passado";
const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "7", label: "7 dias" },
  { key: "15", label: "15 dias" },
  { key: "30", label: "30 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "mes_passado", label: "Mês passado" },
];

function rangeForPreset(preset: Preset): { since: string; until: string } {
  const today = isoDateInBrasilia();
  if (preset === "mes") return { since: monthRangeInBrasilia(0).start, until: today };
  if (preset === "mes_passado") {
    const r = monthRangeInBrasilia(-1);
    return { since: r.start, until: r.end };
  }
  return { since: daysAgoInBrasilia(Number(preset)), until: today };
}

// Gráfico de barras de magnitude — 1 hue só pro volume (leads), sem eixo
// numérico (os rótulos diretos já mostram o valor — ver anti-pattern de
// eixo redundante). Custo por lead entra pela cor (verde = melhor custo) e
// pelo tooltip no hover, nunca como um 2º eixo — eixo duplo é sempre errado.
function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TrafficBreakdownRow & { isBestCpl?: boolean } }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const cpl = row.leads > 0 && row.spend > 0 ? row.spend / row.leads : null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-foreground mb-1">{row.label}</p>
      <p className="text-muted-foreground">{row.leads} lead{row.leads === 1 ? "" : "s"}</p>
      {cpl !== null && <p className="text-muted-foreground">{brl(cpl)} por lead</p>}
      {row.spend > 0 && <p className="text-muted-foreground">{brl(row.spend)} investido</p>}
    </div>
  );
}

function BreakdownChart({
  rows,
  topVolumeLabel,
  bestCplLabel,
}: {
  rows: TrafficBreakdownRow[];
  topVolumeLabel: string | null;
  bestCplLabel: string | null;
}) {
  const rowHeight = 30;
  return (
    <div style={{ height: Math.max(60, rows.length * rowHeight) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={92}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--muted-foreground)"
          />
          <ChartTooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
          <Bar dataKey="leads" radius={4} maxBarSize={18}>
            <LabelList
              dataKey="leads"
              position="right"
              fontSize={11}
              fill="var(--muted-foreground)"
              formatter={(v: number) => (v > 0 ? `${v}` : "")}
            />
            {rows.map((r) => {
              const isBestCpl = r.label === bestCplLabel && bestCplLabel !== topVolumeLabel;
              const isTopVolume = r.label === topVolumeLabel;
              const fill = isBestCpl ? "var(--chart-2)" : isTopVolume ? "var(--chart-1)" : "var(--chart-1)";
              const opacity = isBestCpl || isTopVolume ? 1 : 0.45;
              return <Cell key={r.label} fill={fill} fillOpacity={opacity} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Insight({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
      <TrendingUp className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
      <p className="text-sm text-foreground">{children}</p>
    </div>
  );
}

function bestVolumeOf(rows: TrafficBreakdownRow[]): TrafficBreakdownRow | null {
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  if (totalLeads === 0) return null;
  return rows.reduce((best, r) => (r.leads > best.leads ? r : best), rows[0]);
}

// Menor custo por lead — só entre quem teve lead (sem isso, CPL não existe).
function bestCplOf(rows: TrafficBreakdownRow[]): TrafficBreakdownRow | null {
  const withLeads = rows.filter((r) => r.leads > 0 && r.spend > 0);
  if (withLeads.length === 0) return null;
  return withLeads.reduce((best, r) => (r.spend / r.leads < best.spend / best.leads ? r : best), withLeads[0]);
}

function BreakdownSection({
  title,
  rows,
  insightPrefix,
  sortByLeads,
}: {
  title: string;
  rows: TrafficBreakdownRow[];
  insightPrefix: string;
  sortByLeads?: boolean;
}) {
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  const topVolume = bestVolumeOf(rows);
  const bestCpl = bestCplOf(rows);
  const sameRow = !!topVolume && !!bestCpl && topVolume.label === bestCpl.label;
  const display = sortByLeads ? [...rows].sort((a, b) => b.leads - a.leads) : rows;

  return (
    <div className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {totalLeads === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Sem leads suficientes no período pra esse detalhamento.</p>
      ) : (
        <>
          {topVolume && (
            <Insight>
              {insightPrefix} <strong>{topVolume.label}</strong>, com {topVolume.leads} lead{topVolume.leads === 1 ? "" : "s"}
              {topVolume.spend > 0 ? ` (${brl(topVolume.spend / Math.max(1, topVolume.leads))}/lead)` : ""}
              {sameRow ? " — também o melhor custo por lead." : "."}
            </Insight>
          )}
          {bestCpl && !sameRow && (
            <Insight>
              💰 Melhor custo por lead: <strong>{bestCpl.label}</strong>, {brl(bestCpl.spend / bestCpl.leads)}/lead ({bestCpl.leads} lead{bestCpl.leads === 1 ? "" : "s"}).
              {" "}Vale considerar puxar verba pra esse grupo.
            </Insight>
          )}
          <BreakdownChart rows={display} topVolumeLabel={topVolume?.label ?? null} bestCplLabel={bestCpl?.label ?? null} />
          {!sameRow && bestCpl && topVolume && (
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--chart-1)]" /> Mais leads</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--chart-2)]" /> Melhor custo/lead</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function TrafficInsightsDialog({
  objectId,
  clientId,
  label,
  trigger,
}: {
  objectId: string;
  clientId: string;
  label: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("30");
  const range = rangeForPreset(preset);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["traffic-insights", objectId, range.since, range.until],
    queryFn: async () => {
      const token = await getMetaToken(clientId);
      if (!token) throw new Error("Token Meta não configurado.");
      return fetchTrafficInsights(objectId, token, range.since, range.until);
    },
    enabled: open,
  });

  // Período do dia em 4 janelas, mais fácil de ler que 24 barras soltas.
  const dayParts = data
    ? [
        { label: "Madrugada (0-5h)", leads: data.byHour.slice(0, 6).reduce((s, r) => s + r.leads, 0), spend: data.byHour.slice(0, 6).reduce((s, r) => s + r.spend, 0) },
        { label: "Manhã (6-11h)", leads: data.byHour.slice(6, 12).reduce((s, r) => s + r.leads, 0), spend: data.byHour.slice(6, 12).reduce((s, r) => s + r.spend, 0) },
        { label: "Tarde (12-17h)", leads: data.byHour.slice(12, 18).reduce((s, r) => s + r.leads, 0), spend: data.byHour.slice(12, 18).reduce((s, r) => s + r.spend, 0) },
        { label: "Noite (18-23h)", leads: data.byHour.slice(18, 24).reduce((s, r) => s + r.leads, 0), spend: data.byHour.slice(18, 24).reduce((s, r) => s + r.spend, 0) },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhamento de tráfego — {label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : isError ? (
            <p className="text-sm text-status-critical py-6 text-center">{error instanceof Error ? error.message : "Erro ao buscar o detalhamento."}</p>
          ) : data ? (
            <>
              <BreakdownSection title="Faixa etária" rows={data.byAge} insightPrefix="A faixa etária que mais gerou lead foi" sortByLeads />
              <BreakdownSection title="Gênero" rows={data.byGender} insightPrefix="O público que mais gerou lead foi" sortByLeads />
              <BreakdownSection title="Dia da semana" rows={data.byWeekday} insightPrefix="O dia da semana que mais gerou lead foi" />
              <BreakdownSection title="Horário do dia" rows={dayParts} insightPrefix="O período do dia que mais gerou lead foi" />
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
