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

// Barra de magnitude — 1 hue só (a cor não codifica identidade aqui, todo
// mundo mede a MESMA coisa: leads), proporcional ao maior valor do grupo.
// Rótulo direto no lugar de legenda/tooltip, já que cada linha é seu próprio rótulo.
function BarRow({ label, leads, maxLeads, highlight }: { label: string; leads: number; maxLeads: number; highlight: boolean }) {
  const pct = maxLeads > 0 ? Math.max(leads > 0 ? 4 : 0, (leads / maxLeads) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className={`w-16 shrink-0 text-xs text-right ${highlight ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{label}</span>
      <div className="flex-1 h-5 rounded bg-muted/40 overflow-hidden">
        <div
          className={`h-full rounded ${highlight ? "bg-[var(--chart-1)]" : "bg-[var(--chart-1)]/50"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-14 shrink-0 text-xs tabular-nums ${highlight ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
        {leads} lead{leads === 1 ? "" : "s"}
      </span>
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

function bestOf(rows: TrafficBreakdownRow[]): TrafficBreakdownRow | null {
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  if (totalLeads === 0) return null;
  return rows.reduce((best, r) => (r.leads > best.leads ? r : best), rows[0]);
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
  const best = bestOf(rows);
  const maxLeads = Math.max(1, ...rows.map((r) => r.leads));
  const display = sortByLeads ? [...rows].sort((a, b) => b.leads - a.leads) : rows;

  return (
    <div className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {totalLeads === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Sem leads suficientes no período pra esse detalhamento.</p>
      ) : (
        <>
          {best && (
            <Insight>
              {insightPrefix} <strong>{best.label}</strong>, com {best.leads} lead{best.leads === 1 ? "" : "s"}
              {best.spend > 0 ? ` (${brl(best.spend / Math.max(1, best.leads))}/lead)` : ""}.
            </Insight>
          )}
          <div className="space-y-1.5">
            {display.map((r) => (
              <BarRow key={r.label} label={r.label} leads={r.leads} maxLeads={maxLeads} highlight={best?.label === r.label} />
            ))}
          </div>
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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
