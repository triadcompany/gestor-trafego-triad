import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { fetchClientBalances, type ClientBalance } from "@/lib/queries";
import { getLastSyncedAt } from "@/lib/meta";
import { triggerMetaSync } from "@/server/meta-sync";

export const Route = createFileRoute("/saldos")({
  head: () => ({
    meta: [{ title: "Saldos Meta — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: SaldosPage,
});

// centavos → BRL
function brl(centavos: number) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function balanceStatus(balance: number | null): "ok" | "attention" | "critical" | "unknown" {
  if (balance === null) return "unknown";
  if (balance < 20000) return "critical";   // < R$200
  if (balance < 50000) return "attention";  // < R$500
  return "ok";
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function estimatedDays(balance: number | null, spendToday: number): string {
  if (balance === null) return "—";
  if (spendToday === 0) return "—";
  const days = balance / (spendToday * 100);
  return `~${days.toFixed(1)} dia${days !== 1 ? "s" : ""}`;
}

const STATUS_COLORS = {
  ok: { text: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20", bar: "bg-green-500" },
  attention: { text: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/20", bar: "bg-yellow-500" },
  critical: { text: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20", bar: "bg-red-500" },
  unknown: { text: "text-muted-foreground", bg: "bg-muted/30", border: "border-border", bar: "bg-muted" },
};

function sortByStatus(a: ClientBalance, b: ClientBalance) {
  const order = { critical: 0, attention: 1, ok: 2, unknown: 3 };
  return order[balanceStatus(a.meta_balance)] - order[balanceStatus(b.meta_balance)];
}

function SaldosPage() {
  const queryClient = useQueryClient();

  const { data: lastSyncedAt } = useQuery({
    queryKey: ["last-synced-at"],
    queryFn: getLastSyncedAt,
  });

  const { data: balances = [], isLoading } = useQuery({
    queryKey: ["client-balances"],
    queryFn: fetchClientBalances,
  });

  const syncMutation = useMutation({
    mutationFn: triggerMetaSync,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["client-balances"] });
      queryClient.invalidateQueries({ queryKey: ["last-synced-at"] });
      if (result.errors.length > 0) {
        toast.warning(`Sincronizado com ${result.errors.length} erro(s).`);
      } else {
        toast.success("Saldos atualizados.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao sincronizar"),
  });

  const sorted = [...balances].sort(sortByStatus);
  const maxBalance = Math.max(...balances.map((b) => b.meta_balance ?? 0), 1);
  const totalBalance = balances.reduce((s, b) => s + (b.meta_balance ?? 0), 0);
  const criticalCount = balances.filter((b) => balanceStatus(b.meta_balance) === "critical").length;
  const attentionCount = balances.filter((b) => balanceStatus(b.meta_balance) === "attention").length;

  const syncedLabel = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Saldos Meta</h1>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">
              {syncedLabel ? `Atualizado às ${syncedLabel}` : "Nunca sincronizado"} · automático a cada hora
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="gap-2 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Atualizar agora
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <SummaryCard
            label="Total disponível"
            value={isLoading ? null : brl(totalBalance)}
            sub={`${balances.length} conta${balances.length !== 1 ? "s" : ""} ativa${balances.length !== 1 ? "s" : ""}`}
          />
          <SummaryCard
            label="Contas críticas"
            value={isLoading ? null : String(criticalCount)}
            sub="abaixo de R$ 200"
            valueClass={criticalCount > 0 ? "text-red-500" : undefined}
            icon={criticalCount > 0 ? <AlertTriangle className="h-4 w-4 text-red-500" /> : undefined}
          />
          <SummaryCard
            label="Em atenção"
            value={isLoading ? null : String(attentionCount)}
            sub="R$ 200 – R$ 500"
            valueClass={attentionCount > 0 ? "text-yellow-500" : undefined}
            icon={attentionCount > 0 ? <AlertCircle className="h-4 w-4 text-yellow-500" /> : undefined}
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_140px_110px_110px_90px] gap-0 px-5 py-2.5 bg-muted/40 border-b border-border">
            {["Cliente", "Saldo Meta", "Gasto hoje", "Estimativa", "Status"].map((h, i) => (
              <div key={h} className={`text-[11px] font-mono uppercase tracking-wider text-muted-foreground ${i > 0 ? "text-right" : ""}`}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_110px_110px_90px] gap-0 px-5 py-4 border-b border-border last:border-0">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-5 w-20 ml-auto" />
                <Skeleton className="h-5 w-16 ml-auto" />
                <Skeleton className="h-5 w-16 ml-auto" />
                <Skeleton className="h-5 w-14 ml-auto" />
              </div>
            ))
          ) : sorted.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              Nenhum cliente ativo encontrado.
            </div>
          ) : (
            sorted.map((client) => (
              <BalanceRow
                key={client.id}
                client={client}
                maxBalance={maxBalance}
              />
            ))
          )}
        </div>

        {/* Legend */}
        <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-border">
          {[
            { color: "bg-green-500", label: "Saldo ≥ R$ 500" },
            { color: "bg-yellow-500", label: "R$ 200 – R$ 500" },
            { color: "bg-red-500", label: "Crítico < R$ 200" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <div className={`w-2 h-2 rounded-full ${color}`} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  valueClass,
  icon,
}: {
  label: string;
  value: string | null;
  sub: string;
  valueClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon}
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-24 mt-1" />
      ) : (
        <span className={`text-2xl font-mono font-bold tracking-tight ${valueClass ?? "text-foreground"}`}>{value}</span>
      )}
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

function BalanceRow({ client, maxBalance }: { client: ClientBalance; maxBalance: number }) {
  const status = balanceStatus(client.meta_balance);
  const colors = STATUS_COLORS[status];
  const barPct = client.meta_balance !== null ? Math.max((client.meta_balance / maxBalance) * 100, 2) : 0;

  const statusLabel = { ok: "Ok", attention: "Atenção", critical: "Crítico", unknown: "—" }[status];
  const StatusIcon = { ok: CheckCircle2, attention: AlertCircle, critical: AlertTriangle, unknown: null }[status];

  return (
    <div className="grid grid-cols-[1fr_140px_110px_110px_90px] gap-0 px-5 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
      {/* Cliente */}
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold font-mono shrink-0 ${colors.bg} ${colors.text} border ${colors.border}`}>
          {initials(client.name)}
        </div>
        <div>
          <div className="text-sm font-medium text-foreground leading-tight">{client.name}</div>
          <div className="text-[11px] text-muted-foreground font-mono capitalize">{client.segment}</div>
        </div>
      </div>

      {/* Saldo */}
      <div className="flex flex-col items-end justify-center gap-1">
        <span className={`text-sm font-mono font-bold ${colors.text}`}>
          {client.meta_balance !== null ? brl(client.meta_balance) : "—"}
        </span>
        <div className="w-24 h-1 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${colors.bar} transition-all`} style={{ width: `${barPct}%` }} />
        </div>
      </div>

      {/* Gasto hoje */}
      <div className="flex items-center justify-end">
        <span className="text-sm font-mono text-muted-foreground">
          {client.spendToday > 0 ? `R$ ${client.spendToday.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
        </span>
      </div>

      {/* Estimativa */}
      <div className="flex items-center justify-end">
        <span className={`text-sm font-mono ${status === "critical" ? "text-red-500" : status === "attention" ? "text-yellow-500" : "text-muted-foreground"}`}>
          {estimatedDays(client.meta_balance, client.spendToday)}
        </span>
      </div>

      {/* Status */}
      <div className="flex items-center justify-end">
        {StatusIcon ? (
          <span className={`inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}>
            <StatusIcon className="h-3 w-3" />
            {statusLabel}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">—</span>
        )}
      </div>
    </div>
  );
}
