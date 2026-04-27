import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ExternalLink, Pencil, Plus, Check, X } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { getClient, brl } from "@/lib/mock-data";

export const Route = createFileRoute("/clients/$id")({
  head: () => ({
    meta: [{ title: "Cliente — Gestor de Tráfego" }],
  }),
  component: ClientDetail,
  notFoundComponent: () => (
    <AppShell>
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Cliente não encontrado.</p>
        <Link to="/" className="text-primary underline mt-2 inline-block">Voltar</Link>
      </div>
    </AppShell>
  ),
});

function ClientDetail() {
  const { id } = useParams({ from: "/clients/$id" });
  const client = getClient(id);
  const [editingGoal, setEditingGoal] = useState(false);
  const [cplMin, setCplMin] = useState(client?.cplMin ?? 0);
  const [cplMax, setCplMax] = useState(client?.cplMax ?? 0);

  if (!client) {
    return (
      <AppShell>
        <div className="p-8 text-center">
          <p>Cliente não encontrado.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{client.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Conta {client.adAccountId} · {client.segment}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="#" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Ver no Meta
            </a>
          </Button>
        </div>

        {/* Goal range */}
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Meta de CPL</div>
              {editingGoal ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={cplMin}
                    onChange={(e) => setCplMin(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="number"
                    value={cplMax}
                    onChange={(e) => setCplMax(Number(e.target.value))}
                    className="w-24"
                  />
                  <Button size="icon" variant="ghost" onClick={() => setEditingGoal(false)}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setCplMin(client.cplMin);
                      setCplMax(client.cplMax);
                      setEditingGoal(false);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-xl font-semibold tabular-nums">
                    {brl(cplMin)} – {brl(cplMax)}
                  </span>
                  <Button size="icon" variant="ghost" onClick={() => setEditingGoal(true)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex gap-6">
              <Stat label="CPL hoje" value={client.cplToday !== null ? brl(client.cplToday) : "—"} />
              <Stat label="Gasto" value={brl(client.spendToday)} />
              <Stat label="Leads" value={String(client.leadsToday)} />
            </div>
          </div>
        </Card>

        {/* Chart */}
        <Card className="p-4 mb-6">
          <h2 className="text-sm font-medium mb-4">CPL — últimos 30 dias</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={client.cplHistory} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => brl(v)}
                />
                <ReferenceArea y1={cplMin} y2={cplMax} fill="var(--primary)" fillOpacity={0.08} />
                <Line
                  type="monotone"
                  dataKey="cpl"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Campaigns */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Campanhas ativas</h2>
          <Button asChild size="sm" className="gap-2">
            <Link to="/campaigns/new" search={{ client: client.id }}>
              <Plus className="h-4 w-4" />
              Nova Campanha
            </Link>
          </Button>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Orçamento diário</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">CPL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>
                      {c.status === "active" ? "Ativa" : "Pausada"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(c.dailyBudget)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.leads}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.cpl > 0 ? brl(c.cpl) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
