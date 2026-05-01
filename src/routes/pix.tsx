import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchPixClients, type PixClient } from "@/lib/queries";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/pix")({
  head: () => ({
    meta: [{ title: "Cobranças PIX — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: PixPage,
});

// ── helpers ─────────────────────────────────────────────────────

function parcela(client: PixClient): number {
  switch (client.pix_cycle) {
    case "semanal":   return client.monthly_budget / 4;
    case "quinzenal": return client.monthly_budget / 2;
    case "mensal":    return client.monthly_budget;
  }
}

function getNextPixDate(client: PixClient, today: Date): Date {
  const ref = client.pix_reference_day;

  if (client.pix_cycle === "semanal") {
    // pix_reference_day: 1=Segunda … 7=Domingo
    const targetDow = ref === 7 ? 0 : ref;
    const todayDow = today.getDay();
    let daysUntil = (targetDow - todayDow + 7) % 7;
    const next = new Date(today);
    next.setDate(today.getDate() + daysUntil);
    return next;
  }

  if (client.pix_cycle === "mensal") {
    const next = new Date(today.getFullYear(), today.getMonth(), ref);
    if (next < today) next.setMonth(next.getMonth() + 1);
    return next;
  }

  // quinzenal: occurs on ref and ref+15
  const d1 = new Date(today.getFullYear(), today.getMonth(), ref);
  const d2 = new Date(today.getFullYear(), today.getMonth(), ref + 15);
  const d1next = new Date(today.getFullYear(), today.getMonth() + 1, ref);
  const candidates = [d1, d2, d1next].filter((d) => d >= today);
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
}

function daysUntil(date: Date, today: Date): number {
  const ms = date.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function referenceLabel(client: PixClient): string {
  const ref = client.pix_reference_day;
  if (client.pix_cycle === "semanal") {
    const days = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
    return `toda ${days[ref] ?? ""}`;
  }
  if (client.pix_cycle === "quinzenal") return `dias ${ref} e ${ref + 15}`;
  return `dia ${ref}`;
}

// ── augmented type with computed fields ─────────────────────────

interface PixRow {
  client: PixClient;
  nextDate: Date;
  daysUntil: number;
  parcela: number;
}

function buildRows(clients: PixClient[], today: Date): PixRow[] {
  return clients
    .map((client) => {
      const nextDate = getNextPixDate(client, new Date(today));
      return {
        client,
        nextDate,
        daysUntil: daysUntil(new Date(nextDate), new Date(today)),
        parcela: parcela(client),
      };
    })
    .sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());
}

// ── sub-components ───────────────────────────────────────────────

const CYCLE_STYLES = {
  semanal:   { label: "Semanal",   bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/25" },
  quinzenal: { label: "Quinzenal", bg: "bg-sky-500/10",    text: "text-sky-400",    border: "border-sky-500/25" },
  mensal:    { label: "Mensal",    bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/25" },
};

function CycleBadge({ cycle }: { cycle: PixClient["pix_cycle"] }) {
  const s = CYCLE_STYLES[cycle];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${s.bg} ${s.text} ${s.border}`}>
      {s.label}
    </span>
  );
}

function DueLabel({ days, date }: { days: number; date: Date }) {
  if (days === 0) return <span className="text-red-400 font-semibold">Hoje, {formatDate(date)}</span>;
  if (days <= 3)  return <span className="text-amber-400">{formatDate(date)} · em {days} dias</span>;
  return <span className="text-muted-foreground">{formatDate(date)} · em {days} dias</span>;
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 flex flex-col gap-1 border-t-2 ${accent}`}>
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
      <span className="text-xl font-bold tabular-nums">{value}</span>
    </div>
  );
}

function PixRowItem({ row }: { row: PixRow }) {
  const isToday = row.daysUntil === 0;
  return (
    <div
      className={`flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${
        isToday ? "bg-red-500/5 border-l-2 border-l-red-500" : ""
      }`}
    >
      {/* avatar */}
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground shrink-0">
        {initials(row.client.name)}
      </div>

      {/* name + ref */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{row.client.name}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{referenceLabel(row.client)}</div>
      </div>

      {/* cycle */}
      <div className="hidden sm:block shrink-0">
        <CycleBadge cycle={row.client.pix_cycle} />
      </div>

      {/* mensal */}
      <div className="hidden sm:block text-sm tabular-nums text-muted-foreground shrink-0 min-w-[80px] text-right">
        {brl(row.client.monthly_budget)}
      </div>

      {/* parcela */}
      <div className="text-sm font-bold text-primary tabular-nums shrink-0 min-w-[80px] text-right">
        {brl(row.parcela)}
      </div>

      {/* due */}
      <div className="text-sm tabular-nums shrink-0 min-w-[130px] text-right">
        <DueLabel days={row.daysUntil} date={row.nextDate} />
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-5 py-2 bg-muted/20 border-b border-border text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      {label}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────

function PixPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: clients = [], isLoading, isError } = useQuery({
    queryKey: ["pix-clients"],
    queryFn: fetchPixClients,
  });

  const rows = buildRows(clients, today);

  const todayRows  = rows.filter((r) => r.daysUntil === 0);
  const weekRows   = rows.filter((r) => r.daysUntil > 0 && r.daysUntil <= 7);
  const laterRows  = rows.filter((r) => r.daysUntil > 7);

  const totalHoje    = todayRows.reduce((s, r) => s + r.parcela, 0);
  const totalSemana  = weekRows.reduce((s, r) => s + r.parcela, 0);

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
        {/* header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Cobranças PIX</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Próximos vencimentos por cliente · hoje: {formatDate(today)}
          </p>
        </div>

        {/* summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <SummaryCard
            label="A cobrar hoje"
            value={isLoading ? "—" : totalHoje > 0 ? brl(totalHoje) : "R$ 0"}
            accent="border-t-red-500"
          />
          <SummaryCard
            label="Esta semana"
            value={isLoading ? "—" : totalSemana > 0 ? brl(totalSemana) : "R$ 0"}
            accent="border-t-amber-500"
          />
          <SummaryCard
            label="Clientes PIX"
            value={isLoading ? "—" : String(clients.length)}
            accent="border-t-primary"
          />
        </div>

        {/* table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* column headers */}
          <div className="hidden sm:grid grid-cols-[1fr_100px_90px_90px_140px] gap-4 px-5 py-2.5 bg-muted/20 border-b border-border text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <span>Cliente</span>
            <span className="text-right">Ciclo</span>
            <span className="text-right">Mensal</span>
            <span className="text-right">Parcela</span>
            <span className="text-right">Próximo PIX</span>
          </div>

          {isLoading && (
            <div className="flex flex-col gap-0">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-0">
                  <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-2.5 w-24" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          )}

          {isError && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              Erro ao carregar clientes PIX.
            </div>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-muted-foreground">Nenhum cliente com PIX ativo.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Acesse o{" "}
                <Link to="/clients" className="underline underline-offset-2 hover:text-foreground transition-colors">
                  cadastro do cliente
                </Link>{" "}
                e ative a cobrança PIX.
              </p>
            </div>
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <>
              {todayRows.length > 0 && (
                <>
                  <SectionLabel label="Vencem hoje" />
                  {todayRows.map((r) => <PixRowItem key={r.client.id} row={r} />)}
                </>
              )}
              {weekRows.length > 0 && (
                <>
                  <SectionLabel label="Esta semana" />
                  {weekRows.map((r) => <PixRowItem key={r.client.id} row={r} />)}
                </>
              )}
              {laterRows.length > 0 && (
                <>
                  <SectionLabel label="Mais adiante" />
                  {laterRows.map((r) => <PixRowItem key={r.client.id} row={r} />)}
                </>
              )}
            </>
          )}
        </div>

        {/* legend */}
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-4 mt-4">
            {(["semanal", "quinzenal", "mensal"] as const).map((cycle) => (
              <div key={cycle} className="flex items-center gap-2">
                <CycleBadge cycle={cycle} />
                <span className="text-xs text-muted-foreground">
                  {cycle === "semanal" ? "mensal ÷ 4" : cycle === "quinzenal" ? "mensal ÷ 2" : "valor completo"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* link to configure */}
        <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Settings className="h-3 w-3" />
          <span>Configure o PIX de cada cliente em</span>
          <Link to="/clients" className="underline underline-offset-2 hover:text-foreground transition-colors">
            Clientes → cadastro do cliente
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
