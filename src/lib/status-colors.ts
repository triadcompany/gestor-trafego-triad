import type { ClientStatus } from "@/lib/database.types";

export const statusLabels: Record<ClientStatus, string> = {
  "on-target": "No alvo",
  attention: "Atenção",
  critical: "Crítico",
  "no-data": "Sem dados",
};

export const statusColorClass: Record<ClientStatus, string> = {
  "on-target": "bg-status-on-target",
  attention: "bg-status-attention",
  critical: "bg-status-critical",
  "no-data": "bg-status-no-data",
};

export const statusTextClass: Record<ClientStatus, string> = {
  "on-target": "text-status-on-target",
  attention: "text-status-attention",
  critical: "text-status-critical",
  "no-data": "text-status-no-data",
};

export const STATUS_COLORS: Record<ClientStatus, { text: string; bg: string; border: string; bar: string }> = {
  "on-target": { text: "text-status-on-target", bg: "bg-status-on-target/10", border: "border-status-on-target/20", bar: "bg-status-on-target" },
  attention: { text: "text-status-attention", bg: "bg-status-attention/10", border: "border-status-attention/20", bar: "bg-status-attention" },
  critical: { text: "text-status-critical", bg: "bg-status-critical/10", border: "border-status-critical/20", bar: "bg-status-critical" },
  "no-data": { text: "text-status-no-data", bg: "bg-muted/30", border: "border-border", bar: "bg-muted" },
};
