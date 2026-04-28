import { useState } from "react";
import { CheckCircle2, Pencil, Trash2, X, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportWithClient, PeriodType } from "@/lib/queries";

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
  onUpdate: (id: string, fields: { period_type?: PeriodType; period_start?: string; sent_at?: string | null }) => void;
  onDelete: (id: string) => void;
}

interface EditState {
  period_type: PeriodType;
  period_start: string;
  sent_at: string;
}

export function ReportTable({ reports, isLoading, onMarkSent, onMarkPending, onUpdate, onDelete }: ReportTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ period_type: "mensal", period_start: "", sent_at: "" });

  const pendingCount = reports.filter((r) => r.status === "pendente").length;
  const sentThisMonth = reports.filter((r) => {
    if (r.status !== "enviado" || !r.sent_at) return false;
    const now = new Date();
    const sent = new Date(r.sent_at);
    return sent.getMonth() === now.getMonth() && sent.getFullYear() === now.getFullYear();
  }).length;

  function startEdit(r: ReportWithClient) {
    setEditingId(r.id);
    setEditState({
      period_type: r.period_type,
      period_start: r.period_start,
      sent_at: r.sent_at ? r.sent_at.slice(0, 10) : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function saveEdit(r: ReportWithClient) {
    const fields: Parameters<typeof onUpdate>[1] = {
      period_type: editState.period_type,
      period_start: editState.period_start,
      sent_at: editState.sent_at ? new Date(editState.sent_at + "T12:00:00").toISOString() : null,
    };
    onUpdate(r.id, fields);
    setEditingId(null);
  }

  function handleDelete(id: string) {
    if (!window.confirm("Excluir este relatório?")) return;
    onDelete(id);
  }

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
        <div className="grid grid-cols-[1fr_120px_90px_110px_90px_64px] px-4 py-2.5 bg-muted/40 border-b border-border">
          {["Cliente", "Período", "Tipo", "Envio", "Status", ""].map((h, i) => (
            <div key={i} className={`text-[11px] font-mono uppercase tracking-wider text-muted-foreground ${i > 0 && i < 5 ? "text-center" : ""}`}>
              {h}
            </div>
          ))}
        </div>

        {/* Rows */}
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_90px_110px_90px_64px] px-4 py-3.5 border-b border-border last:border-0">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-20 mx-auto" />
              <Skeleton className="h-4 w-14 mx-auto" />
              <Skeleton className="h-4 w-16 mx-auto" />
              <Skeleton className="h-5 w-16 mx-auto" />
              <Skeleton className="h-4 w-10 mx-auto" />
            </div>
          ))
        ) : reports.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum relatório registrado.
          </div>
        ) : (
          reports.map((r) => {
            const isEditing = editingId === r.id;
            return (
              <div
                key={r.id}
                className={`grid grid-cols-[1fr_120px_90px_110px_90px_64px] px-4 py-3 border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${!isEditing && r.status === "enviado" ? "opacity-60" : ""}`}
              >
                {/* Client */}
                <div className="text-sm text-foreground font-medium self-center">{r.client_name}</div>

                {/* Período */}
                <div className="self-center text-center">
                  {isEditing ? (
                    <input
                      type="date"
                      value={editState.period_start}
                      onChange={(e) => setEditState((s) => ({ ...s, period_start: e.target.value }))}
                      className="text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 w-full text-center text-foreground"
                    />
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatPeriod(r.period_start, r.period_type)}
                    </span>
                  )}
                </div>

                {/* Tipo */}
                <div className="self-center text-center">
                  {isEditing ? (
                    <Select
                      value={editState.period_type}
                      onValueChange={(v) => setEditState((s) => ({ ...s, period_type: v as PeriodType }))}
                    >
                      <SelectTrigger className="h-7 text-xs px-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mensal">Mensal</SelectItem>
                        <SelectItem value="semanal">Semanal</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted/60 text-muted-foreground capitalize">
                      {r.period_type}
                    </span>
                  )}
                </div>

                {/* Envio */}
                <div className="self-center text-center">
                  {isEditing ? (
                    <input
                      type="date"
                      value={editState.sent_at}
                      onChange={(e) => setEditState((s) => ({ ...s, sent_at: e.target.value }))}
                      className="text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 w-full text-center text-foreground"
                    />
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatDate(r.sent_at)}
                    </span>
                  )}
                </div>

                {/* Status */}
                <div className="flex justify-center items-center">
                  {!isEditing && (
                    r.status === "pendente" ? (
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
                    )
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => saveEdit(r)}
                        className="p-1 rounded text-emerald-400 hover:bg-emerald-950 transition-colors"
                        title="Salvar"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Cancelar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(r)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-950 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11px] font-mono text-muted-foreground">
        Clique em "Pendente" para marcar como enviado. Clique em "Enviado" para reverter.
      </p>
    </div>
  );
}
