import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { StatusDot } from "@/components/StatusDot";
import { TokenExpiryBanner } from "@/components/TokenExpiryBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { fetchClients, type ClientStatus } from "@/lib/queries";
import { brl } from "@/lib/mock-data";
import { triggerMetaSync } from "@/server/meta-sync";
import { getLastSyncedAt } from "@/lib/meta";
import { useAutoSync } from "@/hooks/useAutoSync";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Dashboard — Gestor de Tráfego" }],
  }),
  component: Dashboard,
});

const filters: ("all" | ClientStatus)[] = ["all", "on-target", "attention", "critical"];
const filterLabels: Record<string, string> = {
  all: "Todos",
  "on-target": "No alvo",
  attention: "Atenção",
  critical: "Crítico",
};

function Dashboard() {
  const [filter, setFilter] = useState<"all" | ClientStatus>("all");
  const queryClient = useQueryClient();

  useAutoSync();

  const { data: lastSyncedAt } = useQuery({
    queryKey: ["last-synced-at"],
    queryFn: getLastSyncedAt,
    staleTime: 1000 * 60,
  });

  const { data: clients = [], isLoading, isRefetching } = useQuery({
    queryKey: ["clients-dashboard"],
    queryFn: fetchClients,
  });

  const syncMutation = useMutation({
    mutationFn: triggerMetaSync,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["clients-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["last-synced-at"] });
      if (result.errors.length > 0) {
        toast.warning(`Sincronizado ${result.synced} cliente(s) com ${result.errors.length} erro(s).`);
      } else {
        toast.success(`${result.synced} cliente(s) sincronizados com sucesso.`);
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Erro ao sincronizar");
    },
  });

  const counts = useMemo(() => {
    const c = { "on-target": 0, attention: 0, critical: 0, "no-data": 0 } as Record<ClientStatus, number>;
    clients.forEach((cl) => c[cl.status]++);
    return c;
  }, [clients]);

  const filtered = useMemo(
    () => (filter === "all" ? clients : clients.filter((c) => c.status === filter)),
    [filter, clients]
  );

  const [today, setToday] = useState<string>("");
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      })
    );
  }, []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["clients-dashboard"] });
  };

  return (
    <AppShell>
      <TokenExpiryBanner />
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground capitalize">{today}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-0.5">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || isRefetching}
              >
                <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">
                  {syncMutation.isPending ? "Sincronizando..." : "Atualizar"}
                </span>
              </Button>
              {lastSyncedAt && (
                <span className="text-[10px] text-muted-foreground hidden sm:block">
                  Sync: {lastSyncedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/20 text-primary text-sm">GT</AvatarFallback>
            </Avatar>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryCard label="Total" value={clients.length} loading={isLoading} active={filter === "all"} onClick={() => setFilter("all")} />
          <SummaryCard label="No alvo" value={counts["on-target"]} dotStatus="on-target" loading={isLoading} active={filter === "on-target"} onClick={() => setFilter("on-target")} />
          <SummaryCard label="Atenção" value={counts.attention} dotStatus="attention" loading={isLoading} active={filter === "attention"} onClick={() => setFilter("attention")} />
          <SummaryCard label="Crítico" value={counts.critical} dotStatus="critical" loading={isLoading} active={filter === "critical"} onClick={() => setFilter("critical")} />
          <SummaryCard label="Sem dados" value={counts["no-data"]} dotStatus="no-data" loading={isLoading} active={false} onClick={() => setFilter("all")} />
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | ClientStatus)} className="mb-5">
          <TabsList>
            {filters.map((f) => (
              <TabsTrigger key={f} value={f}>
                {filterLabels[f]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {clients.length === 0
              ? "Nenhum cliente cadastrado ainda."
              : "Nenhum cliente nesse status."}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {filtered.map((c) => (
              <Link key={c.id} to="/clients/$id" params={{ id: c.id }} className="block group">
                <Card className="p-4 h-full transition-all hover:border-primary/50 hover:shadow-lg cursor-pointer">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-semibold text-sm leading-tight group-hover:text-primary transition-colors">
                      {c.name}
                    </h3>
                    <StatusDot status={c.status} className="mt-1 shrink-0" />
                  </div>

                  <div className="mb-3">
                    <div className="text-xs text-muted-foreground mb-1">CPL hoje</div>
                    <div className="text-2xl font-bold tabular-nums">
                      {c.cplToday !== null ? brl(c.cplToday) : "—"}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Gasto</div>
                      <div className="text-sm font-medium tabular-nums">{brl(c.spendToday)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Leads</div>
                      <div className="text-sm font-medium tabular-nums">{c.leadsToday}</div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                    Meta: {brl(c.cpl_min)} – {brl(c.cpl_max)}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  dotStatus,
  loading,
  active,
  onClick,
}: {
  label: string;
  value: number;
  dotStatus?: ClientStatus;
  loading?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`p-3 cursor-pointer transition-all select-none ${
        active
          ? "ring-2 ring-primary border-primary/50"
          : "hover:border-primary/30 hover:shadow-sm"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {dotStatus && <StatusDot status={dotStatus} />}
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-10" />
      ) : (
        <div className={`text-2xl font-semibold tabular-nums ${active ? "text-primary" : ""}`}>{value}</div>
      )}
    </Card>
  );
}
