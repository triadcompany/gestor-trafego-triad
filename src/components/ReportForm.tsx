import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X } from "lucide-react";
import type { ClientRow, PeriodType } from "@/lib/queries";

interface ReportFormProps {
  clients: ClientRow[];
  onSave: (payload: { client_id: string; period_type: PeriodType; period_start: string }) => Promise<void>;
  onCancel: () => void;
}

export function ReportForm({ clients, onSave, onCancel }: ReportFormProps) {
  const [clientId, setClientId] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType | "">("");
  const [periodStart, setPeriodStart] = useState("");
  const [saving, setSaving] = useState(false);

  const valid = clientId && periodType && periodStart;

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({ client_id: clientId, period_type: periodType as PeriodType, period_start: periodStart });
      setClientId("");
      setPeriodType("");
      setPeriodStart("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <p className="text-sm font-medium text-foreground">Registrar relatório</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Cliente..." />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={periodType} onValueChange={(v) => setPeriodType(v as PeriodType)}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Tipo..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mensal">Mensal</SelectItem>
            <SelectItem value="semanal">Semanal</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
          className="text-sm"
          placeholder="Início do período"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancelar
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !valid}>
          <Check className="h-3.5 w-3.5 mr-1" /> Registrar
        </Button>
      </div>
    </div>
  );
}
