import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchAdSetsForOptimization, fetchAdSetTargeting, getMetaToken, updateAdSetTargeting, type MetaTargeting } from "@/lib/meta";
import { getN8nMetaWriter } from "@/lib/n8n";
import { FB_POSITION_OPTIONS, IG_POSITION_OPTIONS } from "@/lib/placements";
import { applyTargetingChange, describeChange, type TargetingChange } from "@/lib/optimization-apply";
import type { Suggestion } from "@/lib/optimization";
import { cn } from "@/lib/utils";

const MAX_OPS_PER_CALL = 20;

export function ApplySuggestionDialog({
  suggestion,
  clientId,
  objectId,
  onClose,
}: {
  suggestion: Suggestion;
  clientId: string;
  objectId: string; // campanha selecionada ou a conta inteira (act_...)
  onClose: () => void;
}) {
  const [change, setChange] = useState<TargetingChange>(suggestion.apply!);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const { data: adSets = [], isLoading } = useQuery({
    queryKey: ["optimization-adsets", objectId],
    queryFn: async () => {
      const token = await getMetaToken(clientId);
      if (!token) throw new Error("Token da Meta não encontrado.");
      return fetchAdSetsForOptimization(objectId, token);
    },
    staleTime: 0,
  });

  // Por padrão, só os conjuntos ativos.
  useEffect(() => {
    setSelected(new Set(adSets.filter((a) => a.status === "ACTIVE").map((a) => a.id)));
  }, [adSets]);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const ageError =
    change.kind === "age" &&
    ((change.ageMin !== null && (change.ageMin < 18 || change.ageMin > 65)) ||
      (change.ageMax !== null && (change.ageMax < 18 || change.ageMax > 65)) ||
      (change.ageMin !== null && change.ageMax !== null && change.ageMin > change.ageMax) ||
      (change.ageMin === null && change.ageMax === null));
  const placementError =
    change.kind === "placements" &&
    !((change.facebook && change.fbPositions.length > 0) || (change.instagram && change.igPositions.length > 0));
  const canApply = selected.size > 0 && !ageError && !placementError && !applying;

  async function apply() {
    setApplying(true);
    const pid = "apply-suggestion";
    const progress = (msg: string) => toast.loading(msg, { id: pid });
    try {
      const token = await getMetaToken(clientId);
      if (!token) throw new Error("Token da Meta não encontrado.");
      const ids = adSets.filter((a) => selected.has(a.id)).map((a) => a.id);

      progress("Lendo a segmentação atual dos conjuntos...");
      const ops: Array<{ id: string; targeting: Record<string, unknown> }> = [];
      for (const id of ids) {
        const current = (await fetchAdSetTargeting(id, token)) as Record<string, unknown>;
        ops.push({ id, targeting: applyTargetingChange(current, change) });
      }

      const writer = await getN8nMetaWriter(token, "otimizacao", progress);
      for (let i = 0; i < ops.length; i += MAX_OPS_PER_CALL) {
        const chunk = ops.slice(i, i + MAX_OPS_PER_CALL);
        progress(`Aplicando em ${Math.min(i + chunk.length, ops.length)} de ${ops.length} conjunto(s)...`);
        if (writer) {
          await writer(chunk.map((o) => ({ path: o.id, params: { targeting: JSON.stringify(o.targeting) }, label: `conjunto ${o.id}` })));
        } else {
          for (const o of chunk) await updateAdSetTargeting(o.id, o.targeting as MetaTargeting, token);
        }
      }
      toast.success(`Aplicado em ${ops.length} conjunto${ops.length === 1 ? "" : "s"}.`, { id: pid });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aplicar.", { id: pid, duration: 15000 });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !applying && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aplicar sugestão</DialogTitle>
          <DialogDescription>{suggestion.finding}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-sm font-medium">O que vai mudar</p>
            {change.kind === "age" && <AgeEditor change={change} onChange={setChange} invalid={!!ageError} />}
            {change.kind === "gender" && <GenderEditor change={change} onChange={setChange} />}
            {change.kind === "placements" && <PlacementsEditor change={change} onChange={setChange} invalid={!!placementError} />}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Em quais conjuntos</p>
              {adSets.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelected(selected.size === adSets.length ? new Set() : new Set(adSets.map((a) => a.id)))}
                >
                  {selected.size === adSets.length ? "Desmarcar todos" : "Marcar todos"}
                </button>
              )}
            </div>
            {isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando conjuntos...</p>
            ) : adSets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum conjunto encontrado.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {adSets.map((a) => (
                  <label key={a.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                    <Checkbox checked={selected.has(a.id)} onCheckedChange={(v) => toggle(a.id, !!v)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{a.name}</span>
                      {a.campaignName && <span className="block truncate text-xs text-muted-foreground">{a.campaignName}</span>}
                    </span>
                    <span className={cn("text-xs", a.status === "ACTIVE" ? "text-primary" : "text-muted-foreground")}>
                      {a.status === "ACTIVE" ? "Ativo" : "Pausado"}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-status-attention/10 p-3 text-xs text-status-attention">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Mudar a segmentação de um conjunto ativo reinicia a fase de aprendizado da Meta. Os números desta tela só mostram o efeito depois de alguns dias.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={applying}>Cancelar</Button>
          <Button onClick={apply} disabled={!canApply}>
            {applying ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Aplicando...</> : `Aplicar em ${selected.size} conjunto${selected.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
        <p className="text-xs text-muted-foreground">{describeChange(change)}</p>
      </DialogContent>
    </Dialog>
  );
}

function AgeEditor({
  change,
  onChange,
  invalid,
}: {
  change: Extract<TargetingChange, { kind: "age" }>;
  onChange: (c: TargetingChange) => void;
  invalid: boolean;
}) {
  const parse = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="apply-age-min">Idade mínima</Label>
          <Input
            id="apply-age-min"
            type="number"
            min={18}
            max={65}
            value={change.ageMin ?? ""}
            placeholder="manter a atual"
            onChange={(e) => onChange({ ...change, ageMin: parse(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apply-age-max">Idade máxima</Label>
          <Input
            id="apply-age-max"
            type="number"
            min={18}
            max={65}
            value={change.ageMax ?? ""}
            placeholder="manter a atual"
            onChange={(e) => onChange({ ...change, ageMax: parse(e.target.value) })}
          />
        </div>
      </div>
      <p className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
        {invalid ? "Use idades entre 18 e 65, com a mínima menor que a máxima." : "Em branco = cada conjunto mantém a idade que já tem. 65 = 65 ou mais."}
      </p>
    </div>
  );
}

function GenderEditor({
  change,
  onChange,
}: {
  change: Extract<TargetingChange, { kind: "gender" }>;
  onChange: (c: TargetingChange) => void;
}) {
  const options = [
    { value: "all", label: "Todos" },
    { value: "male", label: "Masculino" },
    { value: "female", label: "Feminino" },
  ] as const;
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange({ kind: "gender", gender: o.value })}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm transition-colors",
            change.gender === o.value ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PlacementsEditor({
  change,
  onChange,
  invalid,
}: {
  change: Extract<TargetingChange, { kind: "placements" }>;
  onChange: (c: TargetingChange) => void;
  invalid: boolean;
}) {
  const togglePos = (field: "fbPositions" | "igPositions", value: string, on: boolean) =>
    onChange({ ...change, [field]: on ? [...change[field], value] : change[field].filter((v) => v !== value) });
  const group = (platform: "facebook" | "instagram", label: string, field: "fbPositions" | "igPositions", options: typeof FB_POSITION_OPTIONS) => (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox checked={change[platform]} onCheckedChange={(v) => onChange({ ...change, [platform]: !!v })} />
        <span className="text-sm font-medium">{label}</span>
      </label>
      {change[platform] && (
        <div className="grid grid-cols-2 gap-1.5 pl-6">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={change[field].includes(o.value)} onCheckedChange={(v) => togglePos(field, o.value, !!v)} />
              <span className="text-sm">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div className="space-y-3">
      {group("facebook", "Facebook", "fbPositions", FB_POSITION_OPTIONS)}
      {group("instagram", "Instagram", "igPositions", IG_POSITION_OPTIONS)}
      <p className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
        {invalid ? "Deixe pelo menos um posicionamento marcado." : "Os conjuntos passam a ter posicionamento manual com exatamente o que estiver marcado aqui."}
      </p>
    </div>
  );
}
