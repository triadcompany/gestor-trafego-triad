import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  X,
  Search,
  Loader2,
  Upload,
  Image,
  Video,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchAllClients,
  fetchConversationTemplates,
  upsertConversationTemplate,
  type ConversationTemplate,
} from "@/lib/queries";
import {
  fetchCampaigns,
  fetchBaseCampaignPrefill,
  waitForVideoReady,
  getMetaToken,
  duplicateCampaign,
  createCampaignFromScratch,
  uploadAdImage,
  uploadAdVideo,
  createAdCreative,
  createAd,
  searchMetaLocations,
  searchMetaInterests,
  type MetaLocationResult,
  type SelectedLocation,
  type MetaInterest,
} from "@/lib/meta";

const FB_POSITIONS = [
  { value: "feed", label: "Feed" },
  { value: "story", label: "Stories" },
  { value: "reels", label: "Reels" },
  { value: "right_hand_column", label: "Coluna direita" },
];

const IG_POSITIONS = [
  { value: "stream", label: "Feed" },
  { value: "story", label: "Stories" },
  { value: "explore", label: "Explorar" },
  { value: "reels", label: "Reels" },
];

interface SearchParams {
  client?: string;
}

export const Route = createFileRoute("/campaigns/new")({
  head: () => ({
    meta: [{ title: "Nova Campanha — Gestor de Tráfego" }],
  }),
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    client: typeof s.client === "string" ? s.client : undefined,
  }),
  component: NewCampaign,
});

function NewCampaign() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  // ── Navigation ──────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Step 1: Campaign ────────────────────────────────────────
  const [clientId, setClientId] = useState(search.client ?? "");
  const [mode, setMode] = useState<"duplicate" | "scratch">("scratch");
  const [baseCampaignId, setBaseCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignType, setCampaignType] = useState<"engagement" | "sales">("engagement");
  const [budget, setBudget] = useState(50);
  const [pageId, setPageId] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");

  // ── Step 2: Targeting ───────────────────────────────────────
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genderMode, setGenderMode] = useState<"all" | "male" | "female">("all");
  const [locations, setLocations] = useState<SelectedLocation[]>([]);
  const [interests, setInterests] = useState<MetaInterest[]>([]);
  const [platforms, setPlatforms] = useState({ facebook: true, instagram: true });
  const [fbPositions, setFbPositions] = useState(["feed", "story"]);
  const [igPositions, setIgPositions] = useState(["stream", "story"]);

  // ── Step 3: Ad creative ─────────────────────────────────────
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [adDescription, setAdDescription] = useState("");
  const [whatsappMessage, setWhatsappMessage] = useState("");

  // ── Duplicate prefill ────────────────────────────────────────
  const [existingVideoId, setExistingVideoId] = useState<string | undefined>();
  const [existingImageHash, setExistingImageHash] = useState<string | undefined>();
  const [existingThumbnailUrl, setExistingThumbnailUrl] = useState<string | undefined>();
  const [instagramActorId, setInstagramActorId] = useState<string | undefined>();
  const [prefillLoading, setPrefillLoading] = useState(false);

  // ── Conversation templates ───────────────────────────────────
  const [templateMode, setTemplateMode] = useState<"select" | "new" | "edit">("select");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplGreeting, setTplGreeting] = useState("");
  const [tplPreMessage, setTplPreMessage] = useState("");

  // ── Result ──────────────────────────────────────────────────
  const [createdId, setCreatedId] = useState<string | null>(null);

  // ── Data ────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-all"],
    queryFn: fetchAllClients,
  });

  const selectedClient = clients.find((c) => c.id === clientId);

  // Pre-fill form when base campaign is selected in duplicate mode
  useEffect(() => {
    if (!baseCampaignId || mode !== "duplicate") return;
    let cancelled = false;
    const load = async () => {
      setPrefillLoading(true);
      try {
        const token = await getMetaToken();
        if (!token || cancelled) return;
        const d = await fetchBaseCampaignPrefill(baseCampaignId, token);
        if (cancelled) return;
        setCampaignType(d.objective === "OUTCOME_SALES" ? "sales" : "engagement");
        setBudget(d.dailyBudget);
        if (d.pageId) setPageId(d.pageId);
        if (d.whatsappNumber) setWhatsappNumber(d.whatsappNumber);
        setInstagramActorId(d.instagramActorId);
        setAgeMin(d.ageMin);
        setAgeMax(d.ageMax);
        setGenderMode(d.genderMode);
        setLocations(d.locations);
        setInterests(d.interests);
        setPlatforms(d.platforms);
        setFbPositions(d.fbPositions);
        setIgPositions(d.igPositions);
        setPrimaryText(d.primaryText);
        setHeadline(d.headline);
        setAdDescription(d.description);
        setMediaType(d.mediaType);
        setExistingVideoId(d.videoId);
        setExistingImageHash(d.imageHash);
        setExistingThumbnailUrl(d.thumbnailUrl);
        setMediaFile(null);
        setMediaPreview(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar dados da campanha");
      } finally {
        if (!cancelled) setPrefillLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [baseCampaignId, mode]);

  const { data: clientCampaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ["campaigns-for-new", clientId],
    queryFn: async () => {
      const token = await getMetaToken();
      if (!token || !selectedClient) return [];
      return fetchCampaigns(selectedClient.meta_ad_account_id, token, "maximum");
    },
    enabled: !!selectedClient && mode === "duplicate",
  });

  const { data: templates = [], isError: templatesError } = useQuery({
    queryKey: ["conversation-templates"],
    queryFn: fetchConversationTemplates,
    retry: false,
  });

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const saveTemplateMutation = useMutation({
    mutationFn: (data: { id?: string; name: string; greeting: string; preMessage: string }) =>
      upsertConversationTemplate({
        id: data.id,
        name: data.name,
        greeting: data.greeting || null,
        pre_message: data.preMessage || null,
      }),
    onSuccess: (tpl) => {
      queryClient.invalidateQueries({ queryKey: ["conversation-templates"] });
      setSelectedTemplateId(tpl.id);
      setWhatsappMessage(tpl.pre_message ?? "");
      setTemplateMode("select");
      toast.success("Modelo salvo.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar modelo"),
  });

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplateId(id);
    const t = templates.find((t) => t.id === id);
    if (t) setWhatsappMessage(t.pre_message ?? "");
  };

  const openNewTemplate = () => {
    setTplName(""); setTplGreeting(""); setTplPreMessage("");
    setTemplateMode("new");
  };

  const openEditTemplate = () => {
    if (!selectedTemplate) return;
    setTplName(selectedTemplate.name);
    setTplGreeting(selectedTemplate.greeting ?? "");
    setTplPreMessage(selectedTemplate.pre_message ?? "");
    setTemplateMode("edit");
  };

  const openDuplicateTemplate = () => {
    if (!selectedTemplate) return;
    setTplName(`${selectedTemplate.name} — Cópia`);
    setTplGreeting(selectedTemplate.greeting ?? "");
    setTplPreMessage(selectedTemplate.pre_message ?? "");
    setTemplateMode("new");
  };

  const handleSaveTemplate = () => {
    saveTemplateMutation.mutate({
      id: templateMode === "edit" ? selectedTemplateId : undefined,
      name: tplName,
      greeting: tplGreeting,
      preMessage: tplPreMessage,
    });
  };

  const handleClientChange = (id: string) => {
    setClientId(id);
    setBaseCampaignId("");
    setCampaignName("");
    const c = clients.find((cl) => cl.id === id);
    setPageId(c?.meta_page_id ?? "");
    setWhatsappNumber(c?.meta_whatsapp_number ?? "");
  };

  const handleBaseCampaignChange = (id: string) => {
    setBaseCampaignId(id);
    const campaign = clientCampaigns.find((c) => c.id === id);
    if (campaign) setCampaignName(`${campaign.name} — Cópia`);
  };

  const handleFileSelect = useCallback((file: File) => {
    setMediaFile(file);
    const url = URL.createObjectURL(file);
    setMediaPreview(url);
  }, []);

  // ── Duplicate mutation ───────────────────────────────────────
  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token Meta não encontrado. Acesse Configurações para renovar.");
      if (!selectedClient) throw new Error("Selecione um cliente.");
      if (!baseCampaignId) throw new Error("Selecione a campanha base.");
      const pid = "duplicate-progress";
      toast.loading("Duplicando campanha na Meta...", { id: pid });
      try {
        const id = await duplicateCampaign(
          baseCampaignId,
          selectedClient.meta_ad_account_id,
          campaignName,
          token,
          (msg) => toast.loading(msg, { id: pid }),
          selectedClient.meta_whatsapp_number ?? undefined
        );
        toast.dismiss(pid);
        return id;
      } catch (err) {
        toast.dismiss(pid);
        throw err;
      }
    },
    onSuccess: (id) => {
      toast.success("Campanha duplicada! Abrindo editor...");
      navigate({
        to: "/campaigns/edit/$id",
        params: { id },
        search: { clientId: clientId ?? "" },
      });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Erro ao duplicar", {
        duration: 12000,
        action: { label: "Ver diagnóstico", onClick: () => navigate({ to: "/diagnostico-meta" }) },
      });
    },
  });

  // ── Create mutation (scratch mode) ───────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token Meta não encontrado. Acesse Configurações.");
      if (!selectedClient) throw new Error("Selecione um cliente.");
      if (!pageId) throw new Error("ID da Página é obrigatório.");
      const hasExistingMedia = !!(existingVideoId || existingImageHash);
      if (!mediaFile && !hasExistingMedia) throw new Error("Selecione uma imagem ou vídeo.");

      const pid = "create-progress";
      const progress = (msg: string) => toast.loading(msg, { id: pid });

      try {
        let finalVideoId: string | undefined = existingVideoId;
        let finalImageHash: string | undefined = existingImageHash;
        let finalThumbnailUrl: string | undefined = existingThumbnailUrl;

        if (mediaFile) {
          if (mediaType === "image") {
            progress("Enviando imagem...");
            finalImageHash = await uploadAdImage(selectedClient.meta_ad_account_id, mediaFile, token);
            finalVideoId = undefined;
            finalThumbnailUrl = undefined;
          } else {
            progress("Enviando vídeo...");
            finalVideoId = await uploadAdVideo(selectedClient.meta_ad_account_id, mediaFile, token);
            finalImageHash = undefined;
            finalThumbnailUrl = (await waitForVideoReady(finalVideoId, token, progress)) ?? existingThumbnailUrl;
          }
        }

        progress("Criando campanha e conjunto...");
        const { campaignId, adSetId } = await createCampaignFromScratch({
          name: campaignName,
          adAccountId: selectedClient.meta_ad_account_id,
          pageId,
          whatsappNumber: whatsappNumber || undefined,
          dailyBudget: budget,
          placements: platforms,
          fbPositions: platforms.facebook ? fbPositions : [],
          igPositions: platforms.instagram ? igPositions : [],
          token,
          campaignType,
          instagramActorId,
          targeting: { ageMin, ageMax, genderMode, locations, interests },
        });

        progress("Criando criativo...");
        const normalizedPhone = (whatsappNumber || "").replace(/\D/g, "");
        const creativeId = await createAdCreative(
          selectedClient.meta_ad_account_id,
          {
            name: campaignName,
            pageId,
            whatsappNumber: normalizedPhone,
            whatsappMessage: whatsappMessage || undefined,
            primaryText,
            headline,
            description: adDescription || undefined,
            mediaType,
            imageHash: finalImageHash,
            videoId: finalVideoId,
            thumbnailUrl: finalThumbnailUrl,
          },
          token
        );

        progress("Criando anúncio...");
        await createAd(
          selectedClient.meta_ad_account_id,
          { name: campaignName, adSetId, creativeId },
          token
        );

        toast.dismiss(pid);
        return campaignId;
      } catch (err) {
        toast.dismiss(pid);
        throw err;
      }
    },
    onSuccess: (id) => setCreatedId(id),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao criar campanha";
      toast.error(msg, {
        duration: 12000,
        action: { label: "Ver diagnóstico", onClick: () => navigate({ to: "/diagnostico-meta" }) },
      });
    },
  });

  // ── Validation ───────────────────────────────────────────────
  const step1ValidDuplicate = !!clientId && !!campaignName && !!baseCampaignId;
  const step1ValidScratch = !!clientId && !!campaignName && budget > 0;
  const hasMedia = !!mediaFile || !!(existingVideoId || existingImageHash);
  const step3Valid = hasMedia && !!primaryText && !!headline;

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
            "{campaignName}" foi criada como <strong>pausada</strong> no Meta Ads.
          </p>
          {mode === "scratch" && (
            <p className="text-sm text-muted-foreground mb-1">
              Revise o criativo e ative quando estiver pronto.
            </p>
          )}
          <p className="text-xs text-muted-foreground mb-6">ID: {createdId}</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Button variant="outline" asChild>
              <Link to="/">Voltar ao dashboard</Link>
            </Button>
            <Button
              onClick={() =>
                navigate({
                  to: "/clients/$id",
                  params: { id: selectedClient.id },
                  search: { openCampaignId: createdId! },
                })
              }
            >
              Abrir campanha
            </Button>
            <Button variant="outline" asChild>
              <a href={metaUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Abrir no Meta
              </a>
            </Button>
            <Button variant="ghost" onClick={() => {
              setCreatedId(null);
              setCampaignName("");
              setBaseCampaignId("");
              setMediaFile(null);
              setMediaPreview(null);
              setPrimaryText("");
              setHeadline("");
              setAdDescription("");
              setWhatsappMessage("");
              setStep(1);
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

        {/* Step indicator — scratch mode only */}
        {mode === "scratch" && <div className="flex items-center gap-2 mb-8">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="flex items-center gap-2">
              <button
                onClick={() => step > n && setStep(n)}
                disabled={step <= n}
                className={[
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                  step === n
                    ? "bg-primary text-primary-foreground"
                    : step > n
                    ? "text-green-500 cursor-pointer hover:bg-green-500/10"
                    : "text-muted-foreground",
                ].join(" ")}
              >
                <span className={[
                  "inline-flex h-5 w-5 shrink-0 rounded-full items-center justify-center text-xs font-semibold",
                  step === n ? "bg-white/20" : step > n ? "bg-green-500 text-white" : "bg-muted",
                ].join(" ")}>
                  {step > n ? <Check className="h-3 w-3" /> : n}
                </span>
                {n === 1 ? "Campanha" : n === 2 ? "Conjunto" : "Anúncio"}
              </button>
              {n < 3 && <div className="h-px w-6 bg-border" />}
            </div>
          ))}
        </div>}

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div className="space-y-5">
            <Card className="p-5 space-y-4">
              <SectionTitle>Cliente & Modo</SectionTitle>

              <div className="space-y-2">
                <Label>Modo</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => {
                    setMode(v as "duplicate" | "scratch");
                    setBaseCampaignId("");
                    setCampaignName("");
                  }}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="scratch" id="scratch" />
                    <Label htmlFor="scratch" className="font-normal cursor-pointer">Criar do zero</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="duplicate" id="dup" />
                    <Label htmlFor="dup" className="font-normal cursor-pointer">Duplicar existente</Label>
                  </div>
                </RadioGroup>
              </div>

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

              {/* Duplicate: base campaign */}
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

            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle>Configuração</SectionTitle>
                {prefillLoading && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Carregando dados da campanha...
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Label>Nome da campanha</Label>
                <Input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder={mode === "duplicate" ? "Preenchido ao selecionar a base" : "Ex: [ENG-MSG] [CIVIC 2024]"}
                />
              </div>

              {mode === "scratch" && (
                <>
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <RadioGroup
                      value={campaignType}
                      onValueChange={(v) => setCampaignType(v as "engagement" | "sales")}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="engagement" id="ct-eng" />
                        <Label htmlFor="ct-eng" className="font-normal cursor-pointer">Engajamento → WhatsApp</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="sales" id="ct-sales" />
                        <Label htmlFor="ct-sales" className="font-normal cursor-pointer">Vendas → WhatsApp</Label>
                      </div>
                    </RadioGroup>
                  </div>

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

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>
                        ID da Página
                        {selectedClient?.meta_page_id && (
                          <span className="ml-1.5 text-xs text-green-500 font-normal">pré-preenchido</span>
                        )}
                      </Label>
                      <Input
                        value={pageId}
                        onChange={(e) => setPageId(e.target.value)}
                        placeholder="123456789012345"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>
                        WhatsApp
                        {selectedClient?.meta_whatsapp_number && (
                          <span className="ml-1.5 text-xs text-green-500 font-normal">pré-preenchido</span>
                        )}
                      </Label>
                      <Input
                        value={whatsappNumber}
                        onChange={(e) => setWhatsappNumber(e.target.value)}
                        placeholder="+5511999999999"
                      />
                    </div>
                  </div>
                </>
              )}
            </Card>

            <div className="flex justify-between gap-3">
              <Button variant="outline" asChild>
                <Link to="/">Cancelar</Link>
              </Button>
              {mode === "duplicate" ? (
                <Button
                  onClick={() => duplicateMutation.mutate()}
                  disabled={!step1ValidDuplicate || duplicateMutation.isPending}
                >
                  {duplicateMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Duplicando...</>
                    : "Duplicar via API"}
                </Button>
              ) : (
                <Button onClick={() => setStep(2)} disabled={!step1ValidScratch}>
                  Avançar →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2: Targeting ── */}
        {step === 2 && (
          <div className="space-y-5">
            <Card className="p-5 space-y-4">
              <SectionTitle>Público-alvo</SectionTitle>

              <div className="space-y-2">
                <Label>Localização</Label>
                <LocationSearch
                  selected={locations}
                  onChange={setLocations}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Faixa etária</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    value={ageMin}
                    onChange={(e) => setAgeMin(Number(e.target.value))}
                    min={18}
                    max={65}
                    className="w-24"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="number"
                    value={ageMax}
                    onChange={(e) => setAgeMax(Number(e.target.value))}
                    min={18}
                    max={65}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">anos</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Gênero</Label>
                <div className="flex gap-2">
                  {(["all", "male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGenderMode(g)}
                      className={[
                        "px-4 py-1.5 rounded-full text-sm border transition-colors",
                        genderMode === g
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-border/80",
                      ].join(" ")}
                    >
                      {g === "all" ? "Todos" : g === "male" ? "Masculino" : "Feminino"}
                    </button>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Interesses <span className="text-muted-foreground font-normal text-xs ml-1">opcional</span></Label>
                <InterestSearch selected={interests} onChange={setInterests} />
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <SectionTitle>Posicionamentos</SectionTitle>

              <div className="flex gap-4">
                {(["facebook", "instagram"] as const).map((p) => (
                  <label key={p} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={platforms[p]}
                      onCheckedChange={(v) => setPlatforms((prev) => ({ ...prev, [p]: !!v }))}
                    />
                    <span className="text-sm capitalize">{p}</span>
                  </label>
                ))}
              </div>

              {platforms.facebook && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Facebook</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FB_POSITIONS.map(({ value, label }) => (
                      <label key={value} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={fbPositions.includes(value)}
                          onCheckedChange={(v) =>
                            setFbPositions((p) => v ? [...p, value] : p.filter((x) => x !== value))
                          }
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {platforms.instagram && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Instagram</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {IG_POSITIONS.map(({ value, label }) => (
                      <label key={value} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={igPositions.includes(value)}
                          onCheckedChange={(v) =>
                            setIgPositions((p) => v ? [...p, value] : p.filter((x) => x !== value))
                          }
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>← Voltar</Button>
              <Button onClick={() => setStep(3)}>Avançar →</Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Ad creative ── */}
        {step === 3 && (
          <div className="space-y-5">
            <Card className="p-5 space-y-4">
              <SectionTitle>Mídia</SectionTitle>

              {/* Image / Video toggle */}
              <div className="flex gap-2">
                {(["image", "video"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setMediaType(t);
                      setMediaFile(null);
                      setMediaPreview(null);
                    }}
                    className={[
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors",
                      mediaType === t
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-border/80",
                    ].join(" ")}
                  >
                    {t === "image" ? <Image className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                    {t === "image" ? "Imagem" : "Vídeo"}
                  </button>
                ))}
              </div>

              {/* Existing media from duplicate — shown when no new file selected */}
              {!mediaFile && existingThumbnailUrl && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <img src={existingThumbnailUrl} alt="Mídia atual" className="w-full max-h-56 object-cover" />
                  <div className="px-4 py-2.5 flex items-center justify-between bg-muted/30">
                    <span className="text-xs text-muted-foreground">
                      {existingVideoId ? "Vídeo atual" : "Imagem atual"} — da campanha base
                    </span>
                    <button
                      onClick={() => { setExistingVideoId(undefined); setExistingImageHash(undefined); setExistingThumbnailUrl(undefined); }}
                      className="text-xs text-muted-foreground hover:text-foreground ml-4 shrink-0"
                    >
                      Trocar
                    </button>
                  </div>
                </div>
              )}
              {(mediaFile || !existingThumbnailUrl) && (
                <UploadZone
                  mediaType={mediaType}
                  file={mediaFile}
                  preview={mediaPreview}
                  onFile={handleFileSelect}
                  onClear={() => { setMediaFile(null); setMediaPreview(null); }}
                />
              )}
            </Card>

            <Card className="p-5 space-y-4">
              <SectionTitle>Texto</SectionTitle>

              <div className="space-y-2">
                <Label>Texto principal</Label>
                <Textarea
                  value={primaryText}
                  onChange={(e) => setPrimaryText(e.target.value)}
                  placeholder="Texto que aparece acima do criativo..."
                  className="min-h-[100px] resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label>Título <span className="text-muted-foreground font-normal text-xs ml-1">aparece abaixo da imagem</span></Label>
                <Input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Ex: Honda Civic 2024 — A partir de R$ 1.890/mês"
                />
              </div>

              <div className="space-y-2">
                <Label>Descrição <span className="text-muted-foreground font-normal text-xs ml-1">opcional</span></Label>
                <Input
                  value={adDescription}
                  onChange={(e) => setAdDescription(e.target.value)}
                  placeholder="Ex: Consulte condições de financiamento"
                />
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle>Configuração da conversa</SectionTitle>
                {templateMode === "select" && (
                  <button
                    type="button"
                    onClick={openNewTemplate}
                    className="text-xs text-primary hover:underline"
                  >
                    + Nova
                  </button>
                )}
              </div>

              {templateMode === "select" ? (
                <>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar modelo salvo..." />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedTemplate && (
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={openEditTemplate}
                          className="text-xs px-2.5 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={openDuplicateTemplate}
                          className="text-xs px-2.5 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                        >
                          Duplicar
                        </button>
                      </div>
                    )}
                  </div>

                  {templatesError ? (
                    <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md p-2.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Tabela <code>conversation_templates</code> não encontrada. Rode a migration no Supabase Dashboard:
                        <br />
                        <code className="select-all">create table if not exists conversation_templates (id uuid primary key default gen_random_uuid(), name text not null, greeting text, pre_message text, created_at timestamptz not null default now());</code>
                      </span>
                    </div>
                  ) : selectedTemplate ? (
                    <div className="bg-muted/40 rounded-lg p-3 space-y-2.5">
                      {selectedTemplate.greeting && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Saudação</p>
                          <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{selectedTemplate.greeting}</p>
                        </div>
                      )}
                      {selectedTemplate.pre_message && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Mensagem pronta</p>
                          <p className="text-xs text-foreground/90">{selectedTemplate.pre_message}</p>
                        </div>
                      )}
                      {!selectedTemplate.greeting && !selectedTemplate.pre_message && (
                        <p className="text-xs text-muted-foreground">Modelo sem conteúdo.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem modelo — nenhuma mensagem pré-preenchida.</p>
                  )}
                </>
              ) : (
                <TemplateForm
                  name={tplName}
                  greeting={tplGreeting}
                  preMessage={tplPreMessage}
                  onNameChange={setTplName}
                  onGreetingChange={setTplGreeting}
                  onPreMessageChange={setTplPreMessage}
                  onSave={handleSaveTemplate}
                  onCancel={() => setTemplateMode("select")}
                  saving={saveTemplateMutation.isPending}
                />
              )}

              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  Abrirá o WhatsApp:{" "}
                  <strong className="text-foreground">{whatsappNumber || "não configurado"}</strong>
                </span>
              </div>
            </Card>

            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={() => setStep(2)}>← Voltar</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!step3Valid || createMutation.isPending}
                className="px-6"
              >
                {createMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Criando...</>
                ) : "Criar Campanha"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Location search ────────────────────────────────────────────

function LocationSearch({
  selected,
  onChange,
}: {
  selected: SelectedLocation[];
  onChange: (locs: SelectedLocation[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetaLocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setResults([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const token = await getMetaToken();
        if (!token) return;
        const data = await searchMetaLocations(q, token);
        setResults(data.filter((r) => !selected.some((s) => s.key === r.key)));
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 400);
  };

  const add = (loc: MetaLocationResult) => {
    const newLoc: SelectedLocation = { key: loc.key, name: loc.name, type: loc.type, region: loc.region };
    onChange([...selected, newLoc]);
    setResults((r) => r.filter((x) => x.key !== loc.key));
    setQuery("");
  };

  const updateRadius = (key: string, radius: number | undefined) => {
    onChange(selected.map((s) => s.key === key ? { ...s, radius } : s));
  };

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-md bg-background">
        {searching ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" /> : <Search className="h-3.5 w-3.5 text-muted-foreground" />}
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar cidade ou estado..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {results.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-popover shadow-sm max-h-56 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.key}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center justify-between gap-2"
              onClick={() => add(r)}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{r.name}</span>
                {r.region && <span className="text-muted-foreground shrink-0">· {r.region}</span>}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{r.type === "city" ? "Cidade" : "Estado"}</span>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 ? (
        <div className="flex flex-col gap-1.5 mt-1">
          {selected.map((loc) => (
            <div key={loc.key} className="flex items-start gap-2 bg-muted/40 rounded-md px-2.5 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-xs font-medium truncate">{loc.name}</span>
                  {loc.region && <span className="text-xs text-muted-foreground shrink-0">— {loc.region}</span>}
                </div>
                {loc.type === "city" && (
                  <div className="flex gap-1 flex-wrap">
                    {([undefined, 30, 50, 80] as const).map((r) => (
                      <button
                        key={r ?? "city"}
                        onClick={() => updateRadius(loc.key, r)}
                        className={[
                          "text-xs px-2 py-0.5 rounded-full border transition-colors",
                          loc.radius === r
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40",
                        ].join(" ")}
                      >
                        {r === undefined ? "Só cidade" : `+${r}km`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => onChange(selected.filter((s) => s.key !== loc.key))} className="mt-0.5 shrink-0">
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sem seleção — cobertura nacional (Brasil).</p>
      )}
    </div>
  );
}

// ── Interest search ────────────────────────────────────────────

function InterestSearch({
  selected,
  onChange,
}: {
  selected: MetaInterest[];
  onChange: (ints: MetaInterest[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetaInterest[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const token = await getMetaToken();
        if (!token) return;
        const data = await searchMetaInterests(q, token);
        setResults(data.filter((r) => !selected.some((s) => s.id === r.id)));
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 400);
  };

  const add = (int: MetaInterest) => {
    onChange([...selected, int]);
    setResults((r) => r.filter((x) => x.id !== int.id));
    setQuery("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-md bg-background">
        {searching ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" /> : <Search className="h-3.5 w-3.5 text-muted-foreground" />}
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar interesse (ex: automóveis, veículos...)"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {results.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-popover shadow-sm">
          {results.slice(0, 8).map((r) => (
            <button
              key={r.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
              onClick={() => add(r)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {selected.map((int) => (
            <Badge key={int.id} variant="secondary" className="gap-1 pr-1 text-xs">
              {int.name}
              <button onClick={() => onChange(selected.filter((s) => s.id !== int.id))}>
                <X className="h-3 w-3 hover:text-foreground" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sem interesses — segmentação ampla.</p>
      )}
    </div>
  );
}

// ── Upload zone ────────────────────────────────────────────────

function UploadZone({
  mediaType,
  file,
  preview,
  onFile,
  onClear,
}: {
  mediaType: "image" | "video";
  file: File | null;
  preview: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = mediaType === "image" ? "image/jpeg,image/png,image/gif,image/webp" : "video/mp4,video/mov,video/avi,video/quicktime";

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  if (file && preview) {
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        {mediaType === "image" ? (
          <img src={preview} alt="Preview" className="w-full max-h-56 object-cover" />
        ) : (
          <video src={preview} controls className="w-full max-h-56" />
        )}
        <div className="px-4 py-2.5 flex items-center justify-between bg-muted/30">
          <span className="text-xs text-muted-foreground truncate">{file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB</span>
          <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground ml-4 shrink-0">Trocar</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={[
          "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
        ].join(" ")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium mb-1">
          Clique para selecionar ou arraste aqui
        </p>
        <p className="text-xs text-muted-foreground">
          {mediaType === "image" ? "JPG, PNG, GIF, WebP" : "MP4, MOV, AVI"}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </>
  );
}

// ── Template form ──────────────────────────────────────────────

function TemplateForm({
  name, greeting, preMessage,
  onNameChange, onGreetingChange, onPreMessageChange,
  onSave, onCancel, saving,
}: {
  name: string; greeting: string; preMessage: string;
  onNameChange: (v: string) => void;
  onGreetingChange: (v: string) => void;
  onPreMessageChange: (v: string) => void;
  onSave: () => void; onCancel: () => void; saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Nome do modelo</Label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Ex: Hyundai HB20 2025" />
      </div>
      <div className="space-y-1.5">
        <Label>
          Saudação
          <span className="text-muted-foreground font-normal text-xs ml-1.5">opcional — mensagem que a empresa envia</span>
        </Label>
        <Textarea
          value={greeting}
          onChange={(e) => onGreetingChange(e.target.value)}
          placeholder={"🚗 Bem-vindo! Somos especializados em..."}
          className="min-h-[80px] resize-none text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label>
          Mensagem pronta
          <span className="text-muted-foreground font-normal text-xs ml-1.5">opcional — enviada pelo cliente</span>
        </Label>
        <Input
          value={preMessage}
          onChange={(e) => onPreMessageChange(e.target.value)}
          placeholder="Ex: Olá, tenho interesse no HB20 2025."
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={!name.trim() || saving}>
          {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Salvando...</> : "Salvar"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-foreground mb-1">{children}</h2>
  );
}
