import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { fetchOptimizationInsights, getMetaToken, type OptimizationInsights, type OptimizationRow } from "@/lib/meta";
import { buildOptimizationReport, brl, MIN_TOTAL_LEADS, type Suggestion } from "@/lib/optimization";
import { daysAgoInBrasilia, isoDateInBrasilia } from "@/lib/brasilia-date";
import { cn } from "@/lib/utils";

const PERIODS = [
  { days: 7, label: "7 dias" },
  { days: 14, label: "14 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOUR_BLOCKS = ["0h", "2h", "4h", "6h", "8h", "10h", "12h", "14h", "16h", "18h", "20h", "22h"];

const num = (v: number, digits = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Aba "Otimização" da página do cliente: onde o dinheiro rende e onde vaza na
// conta de anúncio, com sugestões por regras (ver src/lib/optimization.ts).
export function OptimizationPanel({ clientId, adAccountId }: { clientId: string; adAccountId: string }) {
  const [days, setDays] = useState(30);
  const since = daysAgoInBrasilia(days);
  const until = isoDateInBrasilia();
  const { data, isLoading, error } = useQuery({
    queryKey: ["optimization", adAccountId, since, until],
    queryFn: async () => {
      const token = await getMetaToken(clientId);
      if (!token) throw new Error("Token da Meta não encontrado pra esse cliente.");
      return fetchOptimizationInsights(adAccountId, token, since, until);
    },
    enabled: !!adAccountId,
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">Onde o dinheiro rende e onde ele vaza nessa conta de anúncio.</p>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setDays(p.days)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                days === p.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {!adAccountId ? (
        <p className="text-sm text-muted-foreground">Esse cliente não tem conta de anúncio cadastrada.</p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando dados na Meta...
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error instanceof Error ? error.message : "Erro ao buscar dados da Meta."}
        </div>
      ) : data ? (
        <Report data={data} />
      ) : null}
    </div>
  );
}

function Report({ data }: { data: OptimizationInsights }) {
  const report = useMemo(() => buildOptimizationReport(data), [data]);
  const { spend, leads, impressions, clicks } = data.totals;
  const avg = report.avgCpl;

  const kpis = [
    { label: "Gasto", value: brl(spend) },
    { label: "Conversas iniciadas", value: num(leads) },
    { label: "Custo por conversa", value: avg ? brl(avg) : "—" },
    { label: "CTR", value: impressions > 0 ? `${num((clicks / impressions) * 100, 1)}%` : "—" },
    { label: "CPM", value: impressions > 0 ? brl((spend / impressions) * 1000) : "—" },
  ];

  if (spend === 0) {
    return <p className="text-sm text-muted-foreground">Sem gasto nesse período.</p>;
  }

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl bg-muted/50 px-4 py-3 space-y-1">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-xl font-semibold tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">Onde otimizar</h2>
          <span className="text-xs text-muted-foreground">Economizar primeiro, depois oportunidades e pontos de atenção</span>
        </div>
        {!report.enoughData ? (
          <Notice>
            Só {num(leads)} conversa{leads === 1 ? "" : "s"} no período. Com menos de {MIN_TOTAL_LEADS} não dá pra separar padrão de acaso,
            então nenhuma sugestão é feita. Aumente o período.
          </Notice>
        ) : report.suggestions.length === 0 ? (
          <Notice>Nada fora do padrão: nenhum posicionamento, plataforma, idade, gênero ou horário custa bem acima da média com volume suficiente.</Notice>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.suggestions.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      <Heatmap data={data} />

      <Breakdown title="Plataforma" rows={data.byPlatform} total={data.totals} avg={avg} />
      <Breakdown title="Posicionamento" rows={data.byPosition} total={data.totals} avg={avg} />
      <Breakdown title="Faixa etária" rows={data.byAge} total={data.totals} avg={avg} />
      <Breakdown title="Gênero" rows={data.byGender} total={data.totals} avg={avg} />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

const KIND_STYLE: Record<Suggestion["kind"], { label: string; cls: string }> = {
  economia: { label: "Economizar", cls: "bg-status-attention/15 text-status-attention" },
  oportunidade: { label: "Oportunidade", cls: "bg-primary/15 text-primary" },
  atencao: { label: "Atenção", cls: "bg-muted text-muted-foreground" },
};

function SuggestionCard({ s }: { s: Suggestion }) {
  const kind = KIND_STYLE[s.kind];
  return (
    <article className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", kind.cls)}>{kind.label}</span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{s.dimension}</span>
        </div>
        <span className="text-xs text-muted-foreground">Confiança {s.confidence === "alta" ? "alta" : "média"}</span>
      </div>
      <p className="text-sm leading-relaxed">{s.finding}</p>
      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
        <ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <span className="text-sm font-medium leading-snug">{s.action}</span>
      </div>
      <p className="mt-auto text-xs text-muted-foreground">{s.impactText}</p>
    </article>
  );
}

function Heatmap({ data }: { data: OptimizationInsights }) {
  const max = Math.max(1, ...data.heatLeads.flat());
  const peak = useMemo(() => {
    let best = { d: 0, b: 0, v: -1 };
    data.heatLeads.forEach((row, d) => row.forEach((v, b) => { if (v > best.v) best = { d, b, v }; }));
    return best.v > 0 ? `${WEEKDAYS[best.d]}, ${HOUR_BLOCKS[best.b]}–${parseInt(HOUR_BLOCKS[best.b], 10) + 2}h` : null;
  }, [data]);
  const level = (v: number) => (v === 0 ? 0 : Math.ceil((v / max) * 4));
  const shade = (lvl: number) =>
    lvl === 0 ? "var(--muted)" : `color-mix(in oklab, var(--primary) ${[0, 30, 55, 80, 100][lvl]}%, var(--muted))`;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Quando as conversas acontecem</h2>
        <span className="text-xs text-muted-foreground">Conversas iniciadas por dia e faixa de 2 horas</span>
      </div>
      <div className="overflow-x-auto rounded-xl bg-muted/30 p-4">
        <div className="min-w-[620px] space-y-1">
          <div className="grid grid-cols-[44px_repeat(12,minmax(0,1fr))] gap-1">
            <span />
            {HOUR_BLOCKS.map((h) => (
              <span key={h} className="text-center text-[11px] text-muted-foreground font-mono">{h}</span>
            ))}
          </div>
          {data.heatLeads.map((row, d) => (
            <div key={d} className="grid grid-cols-[44px_repeat(12,minmax(0,1fr))] gap-1 items-center">
              <span className="text-xs text-muted-foreground">{WEEKDAYS[d]}</span>
              {row.map((v, b) => {
                const lvl = level(v);
                return (
                  <div
                    key={b}
                    title={`${WEEKDAYS[d]} ${HOUR_BLOCKS[b]}: ${v} conversa(s) · ${brl(data.heatSpend[d][b])}`}
                    className={cn(
                      "h-8 rounded-md flex items-center justify-center text-xs font-medium tabular-nums",
                      lvl >= 3 ? "text-primary-foreground" : "text-foreground/80"
                    )}
                    style={{ background: shade(lvl) }}
                  >
                    {v > 0 ? v : ""}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 pt-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>0</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className="h-3 w-5 rounded-sm" style={{ background: shade(l) }} />
              ))}
              <span>{num(max)} conversas</span>
            </div>
            {peak && <span className="text-xs text-muted-foreground">Pico: <strong className="text-foreground font-medium">{peak}</strong></span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Breakdown({
  title,
  rows,
  total,
  avg,
}: {
  title: string;
  rows: OptimizationRow[];
  total: OptimizationInsights["totals"];
  avg: number | null;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-muted-foreground/60" />% do gasto</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-primary" />% das conversas</span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl bg-muted/30 px-4 py-1">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[200px_minmax(0,1fr)_110px_90px_150px] gap-4 border-b border-border py-2 text-xs text-muted-foreground">
            <span>Item</span>
            <span>Gasto × conversas</span>
            <span className="text-right">Gasto</span>
            <span className="text-right">Conversas</span>
            <span className="text-right">Custo/conversa</span>
          </div>
          {rows.map((r) => {
            const sp = total.spend > 0 ? (r.spend / total.spend) * 100 : 0;
            const cv = total.leads > 0 ? (r.leads / total.leads) * 100 : 0;
            const cpl = r.leads > 0 ? r.spend / r.leads : null;
            const flag =
              cpl === null
                ? r.spend > 0 ? { text: "sem conversa", cls: "text-status-attention" } : null
                : avg && cpl > avg * 1.3
                  ? { text: `${num(cpl / avg, 1)}× a média`, cls: "text-status-attention" }
                  : avg && cpl < avg * 0.9
                    ? { text: "abaixo da média", cls: "text-primary" }
                    : null;
            return (
              <div key={r.key} className="grid grid-cols-[200px_minmax(0,1fr)_110px_90px_150px] items-center gap-4 border-b border-border/60 py-2.5 last:border-0">
                <span className="text-sm truncate" title={r.label}>{r.label}</span>
                <div className="space-y-1">
                  <div className="h-2 rounded bg-background/60"><div className="h-2 rounded bg-muted-foreground/60" style={{ width: `${Math.max(sp, sp > 0 ? 1 : 0)}%` }} /></div>
                  <div className="h-2 rounded bg-background/60"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(cv, cv > 0 ? 1 : 0)}%` }} /></div>
                </div>
                <span className="text-right text-sm tabular-nums text-muted-foreground">{brl(r.spend)}</span>
                <span className="text-right text-sm tabular-nums text-muted-foreground">{num(r.leads)}</span>
                <span className="flex items-baseline justify-end gap-1.5 tabular-nums">
                  <span className="text-sm font-medium">{cpl === null ? "—" : brl(cpl)}</span>
                  {flag && <span className={cn("text-[11px] font-medium", flag.cls)}>{flag.text}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {avg && (
        <p className="text-xs text-muted-foreground">
          Média da conta: <strong className="text-foreground font-medium">{brl(avg)}</strong> por conversa. Barra cinza maior que a azul = gasta mais do que rende.
        </p>
      )}
    </section>
  );
}
