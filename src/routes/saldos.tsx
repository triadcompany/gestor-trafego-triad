import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertTriangle, AlertCircle, CheckCircle2, SlidersHorizontal, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { fetchClientBalances, type ClientBalance } from "@/lib/queries";
import { getLastSyncedAt, getBalanceThresholds, saveBalanceThresholds, type BalanceThresholds } from "@/lib/meta";
import { triggerMetaSync } from "@/server/meta-sync";
import { STATUS_COLORS } from "@/lib/status-colors";

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

function balanceStatus(balance: number | null, thresholds: BalanceThresholds): "on-target" | "attention" | "critical" | "no-data" {
  if (balance === null) return "no-data";
  if (balance < thresholds.criticalCents) return "critical";
  if (balance < thresholds.attentionCents) return "attention";
  return "on-target";
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

function sortByStatus(a: ClientBalance, b: ClientBalance, thresholds: BalanceThresholds) {
  const order = { critical: 0, attention: 1, "on-target": 2, "no-data": 3 };
  return order[balanceStatus(a.meta_balance, thresholds)] - order[balanceStatus(b.meta_balance, thresholds)];
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

  const { data: thresholds = { criticalCents: 20000, attentionCents: 50000 } } = useQuery({
    queryKey: ["balance-thresholds"],
    queryFn: getBalanceThresholds,
  });

  const [configOpen, setConfigOpen] = useState(false);

  const syncMutation = useMutation({
    mutationFn: () => triggerMetaSync(),
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

  const pixClients = balances.filter((b) => b.payment_method === "pix");
  const sorted = [...balances].sort((a, b) => {
    // cartao always last; among pix, sort by criticality
    if (a.payment_method === "cartao" && b.payment_method !== "cartao") return 1;
    if (a.payment_method !== "cartao" && b.payment_method === "cartao") return -1;
    return sortByStatus(a, b, thresholds);
  });
  const maxBalance = Math.max(...pixClients.map((b) => b.meta_balance ?? 0), 1);
  const criticalCount = pixClients.filter((b) => balanceStatus(b.meta_balance, thresholds) === "critical").length;
  const attentionCount = pixClients.filter((b) => balanceStatus(b.meta_balance, thresholds) === "attention").length;

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
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigOpen((v) => !v)}
              className="gap-2"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Configurar limites
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="gap-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Atualizar agora
            </Button>
          </div>
        </div>

        {configOpen && <ThresholdsConfig thresholds={thresholds} onClose={() => setConfigOpen(false)} />}

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <SummaryCard
            label="Contas críticas"
            value={isLoading ? null : String(criticalCount)}
            sub={`abaixo de ${brl(thresholds.criticalCents)}`}
            valueClass={criticalCount > 0 ? "text-status-critical" : undefined}
            icon={criticalCount > 0 ? <AlertTriangle className="h-4 w-4 text-status-critical" /> : undefined}
          />
          <SummaryCard
            label="Em atenção"
            value={isLoading ? null : String(attentionCount)}
            sub={`${brl(thresholds.criticalCents)} – ${brl(thresholds.attentionCents)}`}
            valueClass={attentionCount > 0 ? "text-status-attention" : undefined}
            icon={attentionCount > 0 ? <AlertCircle className="h-4 w-4 text-status-attention" /> : undefined}
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
          <div className="min-w-[640px]">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_140px_110px_110px_90px_36px] gap-0 px-5 py-2.5 bg-muted/40 border-b border-border">
            {["Cliente", "Saldo Meta", "Gasto ontem", "Estimativa", "Status", ""].map((h, i) => (
              <div key={h || "actions"} className={`text-[11px] font-mono uppercase tracking-wider text-muted-foreground ${i > 0 ? "text-right" : ""}`}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_110px_110px_90px_36px] gap-0 px-5 py-4 border-b border-border last:border-0">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-5 w-20 ml-auto" />
                <Skeleton className="h-5 w-16 ml-auto" />
                <Skeleton className="h-5 w-16 ml-auto" />
                <Skeleton className="h-5 w-14 ml-auto" />
                <Skeleton className="h-5 w-5 ml-auto" />
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
                thresholds={thresholds}
              />
            ))
          )}
          </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4 pt-4 border-t border-border">
          {[
            { color: "bg-status-on-target", label: `Saldo ≥ ${brl(thresholds.attentionCents)}` },
            { color: "bg-status-attention", label: `${brl(thresholds.criticalCents)} – ${brl(thresholds.attentionCents)}` },
            { color: "bg-status-critical", label: `Crítico < ${brl(thresholds.criticalCents)}` },
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

function ThresholdsConfig({ thresholds, onClose }: { thresholds: BalanceThresholds; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [criticalReais, setCriticalReais] = useState(String(thresholds.criticalCents / 100));
  const [attentionReais, setAttentionReais] = useState(String(thresholds.attentionCents / 100));

  const saveMutation = useMutation({
    mutationFn: saveBalanceThresholds,
    onSuccess: () => {
      toast.success("Limites atualizados.");
      queryClient.invalidateQueries({ queryKey: ["balance-thresholds"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar limites"),
  });

  const handleSave = () => {
    const criticalCents = Math.round(Number(criticalReais.replace(",", ".")) * 100);
    const attentionCents = Math.round(Number(attentionReais.replace(",", ".")) * 100);
    if (!criticalCents || !attentionCents || criticalCents <= 0 || attentionCents <= 0) {
      toast.error("Informe valores válidos.");
      return;
    }
    if (attentionCents <= criticalCents) {
      toast.error('O limite "em atenção" precisa ser maior que o "crítico".');
      return;
    }
    saveMutation.mutate({ criticalCents, attentionCents });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 mb-6 flex flex-col sm:flex-row sm:items-end gap-3">
      <div className="flex-1 space-y-1">
        <Label className="text-xs">Crítico — abaixo de (R$)</Label>
        <Input
          value={criticalReais}
          onChange={(e) => setCriticalReais(e.target.value)}
          inputMode="decimal"
          className="h-9"
        />
      </div>
      <div className="flex-1 space-y-1">
        <Label className="text-xs">Em atenção — abaixo de (R$)</Label>
        <Input
          value={attentionReais}
          onChange={(e) => setAttentionReais(e.target.value)}
          inputMode="decimal"
          className="h-9"
        />
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
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

function BalanceRow({ client, maxBalance, thresholds }: { client: ClientBalance; maxBalance: number; thresholds: BalanceThresholds }) {
  const isCard = client.payment_method === "cartao";
  const status = isCard ? "no-data" : balanceStatus(client.meta_balance, thresholds);
  const colors = STATUS_COLORS[status];
  const barPct = !isCard && client.meta_balance !== null ? Math.max((client.meta_balance / maxBalance) * 100, 2) : 0;

  const statusLabel = { "on-target": "Ok", attention: "Atenção", critical: "Crítico", "no-data": "—" }[status];
  const StatusIcon = { "on-target": CheckCircle2, attention: AlertCircle, critical: AlertTriangle, "no-data": null }[status];

  const actId = client.meta_ad_account_id.replace("act_", "");
  const billingUrl = `https://business.facebook.com/billing_hub/accounts/details/?business_id=1034484698873057&asset_id=${actId}&payment_account_id=${actId}&placement=ads_manager&entrypoint=ads_ecosystem_navigation_ads_billing_tool_plugin&payment_account_id_from_jsmodule=${actId}`;

  return (
    <div className="grid grid-cols-[1fr_140px_110px_110px_90px_36px] gap-0 px-5 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
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
        {isCard ? (
          <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border">
            Cartão
          </span>
        ) : (
          <>
            <span className={`text-sm font-mono font-bold ${colors.text}`}>
              {client.meta_balance !== null ? brl(client.meta_balance) : "—"}
            </span>
            <div className="w-24 h-1 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${colors.bar} transition-all`} style={{ width: `${barPct}%` }} />
            </div>
          </>
        )}
      </div>

      {/* Gasto hoje */}
      <div className="flex items-center justify-end">
        <span className="text-sm font-mono text-muted-foreground">
          {client.spendToday > 0 ? `R$ ${client.spendToday.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
        </span>
      </div>

      {/* Estimativa */}
      <div className="flex items-center justify-end">
        <span className={`text-sm font-mono ${status === "critical" ? "text-status-critical" : status === "attention" ? "text-status-attention" : "text-muted-foreground"}`}>
          {isCard ? "—" : estimatedDays(client.meta_balance, client.spendToday)}
        </span>
      </div>

      {/* Status */}
      <div className="flex items-center justify-end">
        {!isCard && StatusIcon ? (
          <span className={`inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}>
            <StatusIcon className="h-3 w-3" />
            {statusLabel}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">—</span>
        )}
      </div>

      {/* Pix */}
      <div className="flex items-center justify-end">
        <a
          href={billingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-md bg-muted/50 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          title="Ir para página de cobrança"
        >
          <CreditCard className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
