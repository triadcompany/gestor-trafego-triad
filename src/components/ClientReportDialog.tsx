import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getMetaToken, fetchCampaigns } from "@/lib/meta";
import { generateClientReportPdf } from "@/lib/client-report-pdf";
import { getCurrentUser } from "@/server/session";
import { cn } from "@/lib/utils";

type Preset = "7" | "15" | "30" | "mes" | "mes_passado" | "custom";

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "7", label: "7 dias" },
  { key: "15", label: "15 dias" },
  { key: "30", label: "30 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "mes_passado", label: "Mês passado" },
  { key: "custom", label: "Personalizado" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function rangeForPreset(preset: Preset, customSince: string, customUntil: string): { since: string; until: string } | null {
  const today = new Date();
  if (preset === "custom") {
    if (!customSince || !customUntil) return null;
    if (customSince > customUntil) return { since: customUntil, until: customSince };
    return { since: customSince, until: customUntil };
  }
  if (preset === "mes") {
    return { since: iso(new Date(today.getFullYear(), today.getMonth(), 1)), until: iso(today) };
  }
  if (preset === "mes_passado") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { since: iso(first), until: iso(last) };
  }
  const days = Number(preset);
  const since = new Date(today);
  since.setDate(today.getDate() - days);
  return { since: iso(since), until: iso(today) };
}

export function ClientReportDialog({
  client,
}: {
  client: { id: string; name: string; meta_ad_account_id: string; cpl_max: number | null };
}) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("30");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: currentUser } = useQuery({ queryKey: ["current-user"], queryFn: getCurrentUser, staleTime: 1000 * 60 });

  const range = useMemo(
    () => rangeForPreset(preset, customSince, customUntil),
    [preset, customSince, customUntil],
  );

  const generate = async () => {
    if (!range) {
      toast.error("Escolha a data de início e de fim.");
      return;
    }
    setLoading(true);
    try {
      const token = await getMetaToken(client.id);
      if (!token) throw new Error("Este cliente não tem token da Meta configurado.");
      const campaigns = await fetchCampaigns(client.meta_ad_account_id, token, "today", range);
      generateClientReportPdf({
        clientName: client.name,
        organizationName: currentUser?.organizationName ?? "Gestão de Tráfego",
        since: range.since,
        until: range.until,
        cplMax: client.cpl_max,
        campaigns,
      });
      toast.success("Relatório gerado.");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar o relatório.", { duration: 8000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <FileText className="h-4 w-4" />
          Relatório PDF
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Relatório de campanhas — {client.name}</DialogTitle>
          <DialogDescription>
            Escolha o período. O PDF traz o resumo e a tabela de campanhas com gasto, leads, CPL, impressões, cliques, CTR e CPM.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Período</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    preset === p.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rep-since">Início</Label>
                <Input id="rep-since" type="date" value={customSince} max={customUntil || undefined} onChange={(e) => setCustomSince(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rep-until">Fim</Label>
                <Input id="rep-until" type="date" value={customUntil} min={customSince || undefined} onChange={(e) => setCustomUntil(e.target.value)} />
              </div>
            </div>
          )}

          {range && (
            <p className="text-xs text-muted-foreground">
              De <strong className="text-foreground">{range.since.split("-").reverse().join("/")}</strong> a{" "}
              <strong className="text-foreground">{range.until.split("-").reverse().join("/")}</strong>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={generate} disabled={loading || !range}>
            {loading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Gerando...
              </>
            ) : (
              "Gerar PDF"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
