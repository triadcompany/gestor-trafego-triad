import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, AlertCircle, TrendingUp, Wallet, CheckCircle2 } from "lucide-react";
import { fetchAttentionItems, type AttentionItem } from "@/lib/queries";
import { STATUS_COLORS } from "@/lib/status-colors";

export const Route = createFileRoute("/visao-geral")({
  head: () => ({
    meta: [{ title: "Visão Geral — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: VisaoGeralPage,
});

const TYPE_META: Record<AttentionItem["type"], { label: string; icon: typeof AlertTriangle }> = {
  cpl_alto: { label: "CPL acima da meta", icon: TrendingUp },
  sem_entrega: { label: "Sem entrega", icon: AlertCircle },
  saldo_baixo: { label: "Saldo acabando", icon: Wallet },
};

const SEVERITY_COLORS = STATUS_COLORS;

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function VisaoGeralPage() {
  const navigate = useNavigate();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["attention-items"],
    queryFn: fetchAttentionItems,
  });

  const critical = items.filter((i) => i.severity === "critical");
  const attention = items.filter((i) => i.severity === "attention");

  const goToItem = (item: AttentionItem) => {
    if (item.type === "saldo_baixo") {
      navigate({ to: "/saldos" });
    } else {
      navigate({
        to: "/clients/$id",
        params: { id: item.clientId },
        search: { openCampaignId: item.campaignId },
      });
    }
  };

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">
            Itens que precisam de atenção agora, em todos os clientes ativos
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <SummaryCard
            label="Críticos"
            value={isLoading ? null : String(critical.length)}
            valueClass={critical.length > 0 ? "text-status-critical" : undefined}
            icon={critical.length > 0 ? <AlertTriangle className="h-4 w-4 text-status-critical" /> : undefined}
          />
          <SummaryCard
            label="Em atenção"
            value={isLoading ? null : String(attention.length)}
            valueClass={attention.length > 0 ? "text-status-attention" : undefined}
            icon={attention.length > 0 ? <AlertCircle className="h-4 w-4 text-status-attention" /> : undefined}
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-border py-16 flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="h-8 w-8 text-status-on-target" />
            <p className="text-sm font-medium text-foreground">Tudo sob controle</p>
            <p className="text-xs text-muted-foreground">Nenhum item precisa de atenção agora.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {critical.length > 0 && (
              <ItemGroup title="Críticos" items={critical} onSelect={goToItem} />
            )}
            {attention.length > 0 && (
              <ItemGroup title="Em atenção" items={attention} onSelect={goToItem} />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ItemGroup({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: AttentionItem[];
  onSelect: (item: AttentionItem) => void;
}) {
  return (
    <div>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{title}</h2>
      <div className="rounded-xl border border-border overflow-hidden">
        {items.map((item, i) => (
          <AttentionRow key={`${item.clientId}-${item.campaignId ?? item.type}-${i}`} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function AttentionRow({ item, onSelect }: { item: AttentionItem; onSelect: (item: AttentionItem) => void }) {
  const colors = SEVERITY_COLORS[item.severity];
  const { label, icon: Icon } = TYPE_META[item.type];

  return (
    <button
      onClick={() => onSelect(item)}
      className="w-full flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 transition-colors text-left"
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold font-mono shrink-0 ${colors.bg} ${colors.text} border ${colors.border}`}>
        {initials(item.clientName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground leading-tight truncate">{item.clientName}</span>
          <span className={`inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full shrink-0 ${colors.bg} ${colors.text} border ${colors.border}`}>
            <Icon className="h-3 w-3" />
            {label}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">{item.detail}</div>
      </div>
      <span className={`text-sm font-mono font-bold shrink-0 ${colors.text}`}>{item.value}</span>
    </button>
  );
}

function SummaryCard({
  label,
  value,
  valueClass,
  icon,
}: {
  label: string;
  value: string | null;
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
        <Skeleton className="h-7 w-12 mt-1" />
      ) : (
        <span className={`text-2xl font-mono font-bold tracking-tight ${valueClass ?? "text-foreground"}`}>{value}</span>
      )}
    </div>
  );
}
