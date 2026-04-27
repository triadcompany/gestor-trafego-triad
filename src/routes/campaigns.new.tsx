import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Upload, Check } from "lucide-react";
import { mockClients, brl } from "@/lib/mock-data";

interface Search {
  client?: string;
}

export const Route = createFileRoute("/campaigns/new")({
  head: () => ({
    meta: [{ title: "Nova Campanha — Gestor de Tráfego" }],
  }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    client: typeof s.client === "string" ? s.client : undefined,
  }),
  component: NewCampaign,
});

function NewCampaign() {
  const search = Route.useSearch();
  const [clientId, setClientId] = useState(search.client ?? "");
  const [mode, setMode] = useState<"duplicate" | "scratch">("scratch");
  const [baseCampaign, setBaseCampaign] = useState("");

  const [name, setName] = useState("");
  const [budget, setBudget] = useState<number>(80);

  const [primaryText, setPrimaryText] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creative, setCreative] = useState<File | null>(null);
  const [waMessage, setWaMessage] = useState(
    "Olá! Vi seu anúncio e quero saber mais."
  );

  const [objective, setObjective] = useState<"engagement" | "sales">("engagement");
  const [igChecked, setIgChecked] = useState(true);
  const [fbChecked, setFbChecked] = useState(true);

  const [reviewing, setReviewing] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedClient = mockClients.find((c) => c.id === clientId);

  if (submitted) {
    return (
      <AppShell>
        <div className="px-4 md:px-8 py-12 max-w-xl mx-auto text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-status-on-target/20 flex items-center justify-center mb-4">
            <Check className="h-7 w-7 text-status-on-target" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Campanha enviada!</h1>
          <p className="text-muted-foreground mb-6">
            "{name}" foi adicionada à fila de criação no Meta Ads.
          </p>
          <div className="flex gap-3 justify-center">
            <Button asChild variant="outline">
              <Link to="/">Voltar ao dashboard</Link>
            </Button>
            <Button onClick={() => { setSubmitted(false); setReviewing(false); }}>
              Criar outra
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Nova Campanha</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Configure uma campanha do Meta Ads para um cliente.
        </p>

        {!reviewing ? (
          <div className="space-y-5">
            {/* Step 1 */}
            <Card className="p-5">
              <StepHeader n={1} title="Cliente & Base" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {mockClients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Base</Label>
                  <RadioGroup value={mode} onValueChange={(v) => setMode(v as "duplicate" | "scratch")}>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="scratch" id="scratch" />
                      <Label htmlFor="scratch" className="font-normal">Criar do zero</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="duplicate" id="duplicate" />
                      <Label htmlFor="duplicate" className="font-normal">Duplicar campanha existente</Label>
                    </div>
                  </RadioGroup>
                </div>

                {mode === "duplicate" && (
                  <div className="space-y-2">
                    <Label>Campanha base</Label>
                    <Select value={baseCampaign} onValueChange={setBaseCampaign}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma campanha" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="c1">Honda Civic 2024 - Azul</SelectItem>
                        <SelectItem value="c2">Toyota Corolla Promo</SelectItem>
                        <SelectItem value="c4">Apartamentos Zona Sul</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </Card>

            {/* Step 2 */}
            <Card className="p-5">
              <StepHeader n={2} title="Detalhes da Campanha" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome da campanha</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Honda Civic 2024 - Azul"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Orçamento diário (R$)</Label>
                  <Input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                  />
                </div>
              </div>
            </Card>

            {/* Step 3 */}
            <Card className="p-5">
              <StepHeader n={3} title="Conteúdo do Anúncio" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Texto principal</Label>
                  <Textarea
                    value={primaryText}
                    onChange={(e) => setPrimaryText(e.target.value)}
                    placeholder="Texto que aparece acima da imagem"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Título</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Criativo (imagem ou vídeo)</Label>
                  <label className="flex items-center justify-center gap-2 border border-dashed border-border rounded-md py-6 cursor-pointer hover:border-primary/50 transition-colors">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {creative ? creative.name : "Clique para enviar"}
                    </span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => setCreative(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <div className="space-y-2">
                  <Label>Mensagem padrão WhatsApp</Label>
                  <Textarea
                    value={waMessage}
                    onChange={(e) => setWaMessage(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            </Card>

            {/* Advanced */}
            <Collapsible>
              <Card className="p-5">
                <CollapsibleTrigger className="flex items-center justify-between w-full text-left group">
                  <div>
                    <h3 className="font-medium">Opções avançadas</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Advantage+ desativado · Segmentação aberta
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Objetivo</Label>
                    <RadioGroup value={objective} onValueChange={(v) => setObjective(v as "engagement" | "sales")}>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="engagement" id="eng" />
                        <Label htmlFor="eng" className="font-normal">Engagement</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="sales" id="sales" />
                        <Label htmlFor="sales" className="font-normal">Sales</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className="space-y-2">
                    <Label>Posicionamentos</Label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="ig"
                          checked={igChecked}
                          onCheckedChange={(v) => setIgChecked(!!v)}
                        />
                        <Label htmlFor="ig" className="font-normal">Instagram</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="fb"
                          checked={fbChecked}
                          onCheckedChange={(v) => setFbChecked(!!v)}
                        />
                        <Label htmlFor="fb" className="font-normal">Facebook</Label>
                      </div>
                      <div className="flex items-center gap-2 opacity-50">
                        <Checkbox id="audn" checked={false} disabled />
                        <Label htmlFor="audn" className="font-normal">Audience Network</Label>
                      </div>
                      <div className="flex items-center gap-2 opacity-50">
                        <Checkbox id="msgr" checked={false} disabled />
                        <Label htmlFor="msgr" className="font-normal">Messenger</Label>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <div className="flex justify-end gap-3">
              <Button variant="outline" asChild>
                <Link to="/">Cancelar</Link>
              </Button>
              <Button onClick={() => setReviewing(true)} disabled={!clientId || !name}>
                Revisar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Card className="p-5">
              <h2 className="font-semibold mb-4">Resumo da campanha</h2>
              <dl className="space-y-3 text-sm">
                <Row label="Cliente" value={selectedClient?.name ?? "—"} />
                <Row label="Modo" value={mode === "scratch" ? "Criar do zero" : "Duplicada"} />
                <Row label="Nome" value={name} />
                <Row label="Orçamento diário" value={brl(budget)} />
                <Row label="Título" value={title || "—"} />
                <Row label="Descrição" value={description || "—"} />
                <Row label="Texto principal" value={primaryText || "—"} />
                <Row label="Criativo" value={creative?.name ?? "Nenhum"} />
                <Row label="Objetivo" value={objective === "engagement" ? "Engagement" : "Sales"} />
                <Row
                  label="Posicionamentos"
                  value={[igChecked && "Instagram", fbChecked && "Facebook"].filter(Boolean).join(", ") || "—"}
                />
                <Row label="Mensagem WhatsApp" value={waMessage} />
              </dl>
            </Card>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setReviewing(false)}>
                Voltar e editar
              </Button>
              <Button onClick={() => setSubmitted(true)}>Confirmar e Subir Campanha</Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-7 w-7 rounded-full bg-primary/15 text-primary text-sm font-semibold flex items-center justify-center">
        {n}
      </div>
      <h2 className="font-semibold">{title}</h2>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-2 last:border-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right break-words">{value}</dd>
    </div>
  );
}
