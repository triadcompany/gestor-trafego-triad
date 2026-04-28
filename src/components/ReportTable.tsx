import { CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReportWithClient } from "@/lib/queries";

function formatPeriod(periodStart: string, periodType: "semanal" | "mensal"): string {
  const d = new Date(periodStart + "T12:00:00");
  if (periodType === "mensal") {
    return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
      .replace(" de ", "/")
      .replace(".", "");
  }
  const end = new Date(d.getTime() + 6 * 86400000);
  const startLabel = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(" de ", " ").replace(".", "");
  const endLabel = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(" de ", " ").replace(".", "");
  return `${startLabel} – ${endLabel}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(" de ", " ").replace(".", "");
}

interface ReportTableProps {
  reports: ReportWithClient[];
  isLoading: boolean;
  onMarkSent: (id: string) => void;
  onMarkPending: (id: string) => void;
}

export function ReportTable({ reports, isLoading, onMarkSent, onMarkPending }: ReportTableProps) {
  const pendingCount = reports.filter((r) => r.status === "pendente").length;
  const sentThisMonth = reports.filter((r) => {
    if (r.status !== "enviado" || !r.sent_at) return false;
    const now = new Date();
    const sent = new Date(r.sent_at);
    return sent.getMonth() === now.getMonth() && sent.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary chips */}
      <div className="flex gap-2 flex-wrap">
        {pendingCount > 0 && (
          <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-amber-950 text-amber-400 border border-amber-900">
            {pendingCount} pendente{pendingCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-900">
          {sentThisMonth} enviado{sentThisMonth !== 1 ? "s" : ""} este mês
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_120px_90px_110px_90px] px-4 py-2.5 bg-muted/40 border-b border-border">
          {["Cliente", "Período", "Tipo", "Envio", "Status"].map((h, i) => (
            <div key={h} className={`text-[11px] font-mono uppercase tracking-wider text-muted-foreground ${i > 0 ? "text-center" : ""}`}>
              {h}
            </div>
          ))}
        </div>

        {/* Rows */}
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_90px_110px_90px] px-4 py-3.5 border-b border-border last:border-0">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-20 mx-auto" />
              <Skeleton className="h-4 w-14 mx-auto" />
              <Skeleton className="h-4 w-16 mx-auto" />
              <Skeleton className="h-5 w-16 mx-auto" />
            </div>
          ))
        ) : reports.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum relatório registrado.
          </div>
        ) : (
          reports.map((r) => (
            <div
              key={r.id}
              className={`grid grid-cols-[1fr_120px_90px_110px_90px] px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${r.status === "enviado" ? "opacity-60" : ""}`}
            >
              <div className="text-sm text-foreground font-medium">{r.client_name}</div>

              <div className="text-xs font-mono text-muted-foreground text-center self-center">
                {formatPeriod(r.period_start, r.period_type)}
              </div>

              <div className="text-center self-center">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted/60 text-muted-foreground capitalize">
                  {r.period_type}
                </span>
              </div>

              <div className="text-xs font-mono text-muted-foreground text-center self-center">
                {formatDate(r.sent_at)}
              </div>

              <div className="flex justify-center items-center">
                {r.status === "pendente" ? (
                  <button
                    onClick={() => onMarkSent(r.id)}
                    className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-900 hover:bg-amber-900 transition-colors cursor-pointer"
                  >
                    Pendente
                  </button>
                ) : (
                  <button
                    onClick={() => onMarkPending(r.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-900 hover:bg-red-950 hover:text-red-400 hover:border-red-900 transition-colors cursor-pointer"
                    title="Clique para reverter para pendente"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Enviado
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] font-mono text-muted-foreground">
        Clique em "Pendente" para marcar como enviado com a data/hora atual.
      </p>
    </div>
  );
}
