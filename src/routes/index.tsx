import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { StatusDot } from "@/components/StatusDot";
import { TokenExpiryBanner } from "@/components/TokenExpiryBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CalendarRange } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchClients, type ClientStatus, type DashboardPeriod } from "@/lib/queries";
import { brl } from "@/lib/mock-data";
import { triggerMetaSync } from "@/server/meta-sync";
import { getLastSyncedAt } from "@/lib/meta";
import { useAutoSync } from "@/hooks/useAutoSync";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Dashboard — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: Dashboard,
});

const periodOptions: { value: DashboardPeriod; label: string }[] = [
  { value: "today",      label: "Hoje" },
  { value: "yesterday",  label: "Ontem" },
  { value: "last_7d",    label: "7 dias" },
  { value: "last_30d",   label: "30 dias" },
  { value: "this_month", label: "Mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "maximum",    label: "Máximo" },
  { value: "custom",     label: "Período" },
];

const cplLabel: Record<DashboardPeriod, string> = {
  today:      "CPL hoje",
  yesterday:  "CPL ontem",
  last_7d:    "CPL 7d",
  last_30d:   "CPL 30d",
  this_month: "CPL mês",
  last_month: "CPL mês ant.",
  maximum:    "CPL total",
  custom:     "CPL período",
};

const STATUS_META: Record<ClientStatus, { label: string; accent: string }> = {
  "on-target": { label: "No alvo",   accent: "bg-green-500" },
  attention:   { label: "Atenção",   accent: "bg-yellow-500" },
  critical:    { label: "Crítico",   accent: "bg-red-500" },
  "no-data":   { label: "Sem dados", accent: "bg-border" },
};

function cplStatusClass(cpl: number | null, cplMax: number): string {
  if (cpl === null) return "";
  if (cpl <= cplMax) return "text-green-500";
  if (cpl <= cplMax * 1.3) return "text-yellow-500";
  return "text-red-500";
}

function Dashboard() {
  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const [filter, setFilter] = useState<"all" | ClientStatus>("all");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const queryClient = useQueryClient();

  useAutoSync();

  const toggleFilter = (f: ClientStatus) =>
    setFilter((prev) => (prev === f ? "all" : f));

  const customRange =
    period === "custom" && customSince && customUntil
      ? { since: customSince, until: customUntil }
      : undefined;
  const customReady = period !== "custom" || !!customRange;

  const { data: lastSyncedAt } = useQuery({
    queryKey: ["last-synced-at"],
    queryFn: getLastSyncedAt,
    staleTime: 1000 * 60,
  });

  const { data: clients = [], isFetching } = useQuery({
    queryKey: ["clients-dashboard", period, customSince, customUntil],
    queryFn: () => fetchClients(period, customRange),
    staleTime: 0,
    enabled: customReady,
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
    const raw = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
    setToday(raw.charAt(0).toUpperCase() + raw.slice(1));
  }, []);

  return (
    <AppShell>
      <TokenExpiryBanner />
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">{today}</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Period selector */}
            <div className="flex flex-col items-end gap-1.5">
              <div
                role="group"
                aria-label="Selecionar período"
                className="flex flex-wrap rounded-md border border-border overflow-hidden text-xs"
              >
                {periodOptions.map((opt) => (
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

              {/* Inputs de data para período personalizado */}
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

            {/* Sync button */}
            <div className="flex flex-col items-end gap-0.5">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label={syncMutation.isPending ? "Sincronizando dados" : "Sincronizar dados"}
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "motion-safe:animate-spin" : ""}`} />
                <span className="hidden sm:inline">
                  {syncMutation.isPending ? "Sincronizando…" : "Atualizar"}
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

        {/* Summary cards — também atuam como filtros */}
        <div
          role="group"
          aria-label="Filtrar clientes por status"
          className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6"
        >
          <SummaryCard
            label="Total"
            value={clients.length}
            loading={isFetching}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {(["on-target", "attention", "critical", "no-data"] as ClientStatus[]).map((s) => (
            <SummaryCard
              key={s}
              label={STATUS_META[s].label}
              value={counts[s]}
              dotStatus={s}
              loading={isFetching}
              active={filter === s}
              onClick={() => toggleFilter(s)}
            />
          ))}
        </div>

        {/* Client grid */}
        {isFetching ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-4 w-28 rounded" />
                  <Skeleton className="h-3 w-3 rounded-full shrink-0" />
                </div>
                <div>
                  <Skeleton className="h-3 w-16 mb-2 rounded" />
                  <Skeleton className="h-7 w-24 rounded" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-10 rounded" />
                    <Skeleton className="h-4 w-14 rounded" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-10 rounded" />
                    <Skeleton className="h-4 w-8 rounded" />
                  </div>
                </div>
                <Skeleton className="h-3 w-32 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-sm">
              {clients.length === 0
                ? "Nenhum cliente cadastrado ainda."
                : "Nenhum cliente com esse status."}
            </p>
            {filter !== "all" && (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="mt-2 text-xs text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                Ver todos os clientes
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {filtered.map((c) => (
              <Link
                key={c.id}
                to="/clients/$id"
                params={{ id: c.id }}
                search={{ openCampaignId: undefined }}
                className="block group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="p-4 h-full transition-all group-hover:border-primary/50 group-hover:shadow-md cursor-pointer overflow-hidden relative">
                  {/* Barra de status no topo */}
                  <div className={`absolute inset-x-0 top-0 h-0.5 ${STATUS_META[c.status].accent}`} />

                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                      {c.name}
                    </h3>
                    <StatusDot status={c.status} className="mt-0.5 shrink-0" />
                  </div>

                  <div className="mb-3">
                    <div className="text-xs text-muted-foreground mb-1">{cplLabel[period]}</div>
                    <div className={`text-2xl font-bold tabular-nums ${cplStatusClass(c.cplToday, c.cpl_max)}`}>
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

                  <div className="text-xs text-muted-foreground pt-2 border-t border-border tabular-nums">
                    Meta: {brl(c.cpl_min)}{" – "}{brl(c.cpl_max)}
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
      role="button"
      tabIndex={0}
      aria-pressed={active}
      className={`p-3 cursor-pointer transition-all select-none touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "ring-2 ring-primary border-primary/50"
          : "hover:border-primary/30 hover:shadow-sm"
      }`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {dotStatus && <StatusDot status={dotStatus} />}
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-10" />
      ) : (
        <div className={`text-2xl font-semibold tabular-nums ${active ? "text-primary" : ""}`}>
          {value}
        </div>
      )}
    </Card>
  );
}
