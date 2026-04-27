import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RefreshCw } from "lucide-react";
import { mockClients, statusLabels, brl, type ClientStatus } from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Dashboard — Gestor de Tráfego" }],
  }),
  component: Dashboard,
});

const filters: ("all" | ClientStatus)[] = ["all", "on-target", "attention", "critical"];

function Dashboard() {
  const [filter, setFilter] = useState<"all" | ClientStatus>("all");

  const counts = useMemo(() => {
    const c = { "on-target": 0, attention: 0, critical: 0, "no-data": 0 } as Record<ClientStatus, number>;
    mockClients.forEach((cl) => {
      c[cl.status]++;
    });
    return c;
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? mockClients : mockClients.filter((c) => c.status === filter)),
    [filter]
  );

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground capitalize">{today}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/20 text-primary text-sm">RA</AvatarFallback>
            </Avatar>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryCard label="Total" value={mockClients.length} />
          <SummaryCard label="No alvo" value={counts["on-target"]} dotStatus="on-target" />
          <SummaryCard label="Atenção" value={counts.attention} dotStatus="attention" />
          <SummaryCard label="Crítico" value={counts.critical} dotStatus="critical" />
          <SummaryCard label="Sem dados" value={counts["no-data"]} dotStatus="no-data" />
        </div>

        {/* Filter tabs */}
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | ClientStatus)} className="mb-5">
          <TabsList>
            {filters.map((f) => (
              <TabsTrigger key={f} value={f}>
                {f === "all" ? "Todos" : statusLabels[f]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Client cards grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map((c) => (
            <Link
              key={c.id}
              to="/clients/$id"
              params={{ id: c.id }}
              className="block group"
            >
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
                    <div className="text-[11px] text-muted-foreground">Gasto</div>
                    <div className="text-sm font-medium tabular-nums">{brl(c.spendToday)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Leads</div>
                    <div className="text-sm font-medium tabular-nums">{c.leadsToday}</div>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground pt-2 border-t border-border">
                  Meta: {brl(c.cplMin)} – {brl(c.cplMax)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  dotStatus,
}: {
  label: string;
  value: number;
  dotStatus?: ClientStatus;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {dotStatus && <StatusDot status={dotStatus} />}
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}
