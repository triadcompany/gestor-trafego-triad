import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Check, ExternalLink, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { fetchAllClients } from "@/lib/queries";
import {
  fetchCampaigns,
  getMetaToken,
  duplicateCampaign,
  createCampaignFromScratch,
} from "@/lib/meta";

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
  const navigate = useNavigate();

  const [clientId, setClientId] = useState(search.client ?? "");
  const [mode, setMode] = useState<"duplicate" | "scratch">("duplicate");
  const [baseCampaignId, setBaseCampaignId] = useState("");
  const [name, setName] = useState("");
  const [budget, setBudget] = useState<number>(10);
  const [pageId, setPageId] = useState("");
  const [igChecked, setIgChecked] = useState(true);
  const [fbChecked, setFbChecked] = useState(true);

  const [createdId, setCreatedId] = useState<string | null>(null);

  // ── Real data ────────────────────────────────────────────────
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-all"],
    queryFn: fetchAllClients,
  });

  const selectedClient = clients.find((c) => c.id === clientId);

  const { data: clientCampaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ["campaigns-for-new", clientId],
    queryFn: async () => {
      const token = await getMetaToken();
      if (!token || !selectedClient) return [];
      return fetchCampaigns(selectedClient.meta_ad_account_id, token, "maximum");
    },
    enabled: !!selectedClient && mode === "duplicate",
  });

  // When client changes, pre-fill page_id from stored value
  const handleClientChange = (id: string) => {
    setClientId(id);
    setBaseCampaignId("");
    setName("");
    const c = clients.find((cl) => cl.id === id);
    setPageId(c?.meta_page_id ?? "");
  };

  // When base campaign is selected, pre-fill name
  const handleBaseCampaignChange = (id: string) => {
    setBaseCampaignId(id);
    const campaign = clientCampaigns.find((c) => c.id === id);
    if (campaign) setName(`${campaign.name} — Cópia`);
  };

  // ── Submit ───────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token Meta não encontrado. Acesse Configurações para renovar.");
      if (!selectedClient) throw new Error("Selecione um cliente.");

      if (mode === "duplicate") {
        if (!baseCampaignId) throw new Error("Selecione a campanha base.");
        const progressToastId = "duplicate-progress";
        toast.loading("Duplicando campanha na Meta...", { id: progressToastId });
        try {
          const id = await duplicateCampaign(
            baseCampaignId,
            selectedClient.meta_ad_account_id,
            name,
            token,
            (msg) => toast.loading(msg, { id: progressToastId })
          );
          toast.dismiss(progressToastId);
          return id;
        } catch (err) {
          toast.dismiss(progressToastId);
          throw err;
        }
      } else {
        if (!pageId) throw new Error("Informe o ID da Página do Facebook.");
        const { campaignId } = await createCampaignFromScratch({
          name,
          adAccountId: selectedClient.meta_ad_account_id,
          pageId,
          dailyBudget: budget,
          placements: { facebook: fbChecked, instagram: igChecked },
          token,
        });
        return campaignId;
      }
    },
    onSuccess: (id) => {
      setCreatedId(id);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao criar campanha";
      toast.error(msg, {
        duration: 12000,
        action: {
          label: "Ver diagnóstico",
          onClick: () => navigate({ to: "/diagnostico-meta" }),
        },
      });
    },
  });

  const canSubmit =
    !!clientId &&
    !!name &&
    (mode === "duplicate" ? !!baseCampaignId : budget > 0);

  // ── Success screen ───────────────────────────────────────────
  if (createdId && selectedClient) {
    const metaUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${selectedClient.meta_ad_account_id.replace("act_", "")}`;
    return (
      <AppShell>
        <div className="px-4 md:px-8 py-12 max-w-xl mx-auto text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <Check className="h-7 w-7 text-green-500" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Campanha criada!</h1>
          <p className="text-muted-foreground mb-1">
            "{name}" foi criada como <strong>pausada</strong> no Meta Ads.
          </p>
          {mode === "scratch" && (
            <p className="text-sm text-muted-foreground mb-6">
              Adicione o criativo (imagem/vídeo e texto) no Gerenciador de Anúncios antes de ativar.
            </p>
          )}
          <p className="text-xs text-muted-foreground mb-6">ID: {createdId}</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Button variant="outline" asChild>
              <Link to="/">Voltar ao dashboard</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={metaUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Abrir no Meta
              </a>
            </Button>
            <Button onClick={() => {
              setCreatedId(null);
              setName("");
              setBaseCampaignId("");
            }}>
              Criar outra
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight mb-1">Nova Campanha</h1>
        <p className="text-sm text-muted-foreground mb-6">
          A campanha será criada <strong>pausada</strong> para revisão antes de ativar.
        </p>

        <div className="space-y-5">
          {/* Cliente & modo */}
          <Card className="p-5 space-y-4">
            <StepHeader n={1} title="Cliente & Base" />

            <div className="space-y-2">
              <Label>Cliente</Label>
              {clientsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={clientId} onValueChange={handleClientChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.filter((c) => c.active).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Modo</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "duplicate" | "scratch")} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="duplicate" id="dup" />
                  <Label htmlFor="dup" className="font-normal cursor-pointer">Duplicar campanha existente</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="scratch" id="scr" />
                  <Label htmlFor="scr" className="font-normal cursor-pointer">Criar do zero</Label>
                </div>
              </RadioGroup>
            </div>

            {mode === "duplicate" && clientId && (
              <div className="space-y-2">
                <Label>Campanha base</Label>
                {campaignsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : clientCampaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma campanha encontrada para este cliente.</p>
                ) : (
                  <Select value={baseCampaignId} onValueChange={handleBaseCampaignChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma campanha" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientCampaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${c.status === "ACTIVE" ? "bg-green-500" : "bg-muted-foreground"}`} />
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </Card>

          {/* Configuração */}
          <Card className="p-5 space-y-4">
            <StepHeader n={2} title="Configuração" />

            <div className="space-y-2">
              <Label>Nome da campanha</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={mode === "duplicate" ? "Preenchido ao selecionar a base" : "Ex: [ENG-MSG] [CIVIC 2024]"}
              />
            </div>

            {mode === "scratch" && (
              <>
                <div className="space-y-2">
                  <Label>Orçamento diário (R$)</Label>
                  <Input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    min={1}
                    step={1}
                  />
                </div>

                <div className="space-y-2">
                  <Label>
                    ID da Página do Facebook
                    <span className="text-muted-foreground font-normal ml-1">(obrigatório para WhatsApp)</span>
                  </Label>
                  <Input
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    placeholder="Ex: 123456789012345"
                  />
                  {!selectedClient?.meta_page_id && pageId && (
                    <p className="text-xs text-muted-foreground">
                      Salve o Page ID no cadastro do cliente para não precisar informar toda vez.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Posicionamentos</Label>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox id="ig" checked={igChecked} onCheckedChange={(v) => setIgChecked(!!v)} />
                      <Label htmlFor="ig" className="font-normal cursor-pointer">Instagram</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="fb" checked={fbChecked} onCheckedChange={(v) => setFbChecked(!!v)} />
                      <Label htmlFor="fb" className="font-normal cursor-pointer">Facebook</Label>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Serão criados a campanha e o conjunto de anúncios (objetivo: Engajamento / WhatsApp).
                    O criativo (imagem/vídeo + texto) deve ser adicionado no Gerenciador de Anúncios.
                  </span>
                </div>
              </>
            )}
          </Card>

          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="outline" asChild>
              <Link to="/">Cancelar</Link>
            </Button>
            {mode === "duplicate" && selectedClient && baseCampaignId && (
              <Button variant="outline" asChild>
                <a
                  href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${selectedClient.meta_ad_account_id.replace("act_", "")}&selected_campaign_ids=${baseCampaignId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Duplicar no Meta
                </a>
              </Button>
            )}
            <Button
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? "Criando..." : mode === "duplicate" ? "Duplicar via API" : "Criar Campanha"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="h-7 w-7 rounded-full bg-primary/15 text-primary text-sm font-semibold flex items-center justify-center shrink-0">
        {n}
      </div>
      <h2 className="font-semibold">{title}</h2>
    </div>
  );
}
