import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect, lazy, Suspense } from "react";
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
  MapPin,
  Plus,
} from "lucide-react";
// Import dinâmico (nunca estático) — o Leaflet acessa `window` na hora de
// carregar o módulo e derruba a renderização no servidor (SSR) se for
// importado direto no topo do arquivo.
const LocationsMap = lazy(() =>
  import("@/components/LocationsMap").then((m) => ({ default: m.LocationsMap }))
);
const MAP_FALLBACK = (
  <div className="h-[260px] rounded-lg border border-border bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">
    Carregando mapa...
  </div>
);
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
import { getN8nWebhookUrl, triggerN8nCampaign, pollN8nJob } from "@/lib/n8n";

// Sem "Reels" — não é suportado pelo posicionamento manual em campanhas de
// WhatsApp (destination_type CONVERSATIONS), que é o único tipo criado aqui.
const FB_POSITIONS = [
  { value: "feed", label: "Feed" },
  { value: "story", label: "Stories" },
  { value: "right_hand_column", label: "Coluna direita" },
];

const IG_POSITIONS = [
  { value: "stream", label: "Feed" },
  { value: "story", label: "Stories" },
  { value: "explore", label: "Explorar" },
  { value: "reels", label: "Reels" },
];

// ── Criar em massa: 1 campanha por carro, mesma config. compartilhada ────────

interface BulkCar {
  id: string;
  name: string;
  mediaType: "image" | "video";
  mediaFile: File | null;
  mediaPreview: string | null;
  primaryText: string;
  headline: string;
  description: string;
  whatsappGreeting: string;
  whatsappMessage: string;
}

function makeEmptyBulkCar(): BulkCar {
  return {
    id: crypto.randomUUID(),
    name: "",
    mediaType: "image",
    mediaFile: null,
    mediaPreview: null,
    primaryText: "",
    headline: "",
    description: "",
    whatsappGreeting: "",
    whatsappMessage: "",
  };
}

interface BulkSharedConfig {
  adAccountId: string;
  pageId: string;
  whatsappNumber: string;
  campaignType: "engagement" | "sales";
  budget: number;
  placementMode: "advantage_plus" | "manual";
  platforms: { facebook: boolean; instagram: boolean };
  fbPositions: string[];
  igPositions: string[];
  bidAmount: number | "";
  instagramActorId?: string;
  ageMin: number;
  ageMax: number;
  genderMode: "all" | "male" | "female";
  locations: SelectedLocation[];
  interests: MetaInterest[];
}

async function waitForN8nJob(jobId: string, onProgress?: (msg: string) => void): Promise<string> {
  const start = Date.now();
  const timeoutMs = 5 * 60 * 1000;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const status = await pollN8nJob(jobId);
    if (status?.status === "done") {
      if (!status.campaignId) throw new Error("n8n concluiu mas não retornou o ID da campanha.");
      return status.campaignId;
    }
    if (status?.status === "error") throw new Error(status.errorMessage || "Erro desconhecido no n8n.");
    onProgress?.("Aguardando o n8n processar...");
  }
  throw new Error("O n8n não respondeu a tempo (5min).");
}

/**
 * Cria 1 campanha completa (campanha + conjunto + criativo + anúncio) pra 1 carro
 * do modo "Criar em massa". Duplica de propósito a lógica de criação de
 * campanhas.new.tsx (createMutation) em vez de compartilhar — mantém o fluxo de
 * criação única (já testado) intocado, evitando qualquer regressão nele.
 */
async function createOneBulkCampaign(
  shared: BulkSharedConfig,
  car: BulkCar,
  token: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  if (!car.mediaFile) throw new Error("Selecione uma imagem ou vídeo.");
  if (!car.name.trim()) throw new Error("Digite o nome do carro.");

  let finalImageHash: string | undefined;
  let finalVideoId: string | undefined;
  let finalThumbnailUrl: string | undefined;

  if (car.mediaType === "image") {
    onProgress?.("Enviando imagem...");
    finalImageHash = await uploadAdImage(shared.adAccountId, car.mediaFile, token);
  } else {
    onProgress?.("Enviando vídeo...");
    finalVideoId = await uploadAdVideo(shared.adAccountId, car.mediaFile, token, onProgress);
    finalThumbnailUrl = (await waitForVideoReady(finalVideoId, token, onProgress)) ?? undefined;
  }

  const tag = shared.campaignType === "sales" ? "VENDAS-WHATS" : "ENG-MSG";
  const campaignName = `[${tag}] [${car.name.trim().toUpperCase()}]`;
  const adSetName = "CA1 - ABERTO";
  const adName = `AD1 - ${car.mediaType === "video" ? "VIDEO" : "ARTE"}`;
  const normalizedPhone = (shared.whatsappNumber || "").replace(/\D/g, "");

  const campaignOptions = {
    name: campaignName,
    adSetName,
    adAccountId: shared.adAccountId,
    pageId: shared.pageId,
    whatsappNumber: shared.whatsappNumber || undefined,
    dailyBudget: shared.budget,
    placementMode: shared.placementMode,
    placements: shared.platforms,
    fbPositions: shared.platforms.facebook ? shared.fbPositions : [],
    igPositions: shared.platforms.instagram ? shared.igPositions : [],
    bidAmount: shared.placementMode === "manual" && shared.bidAmount !== "" ? shared.bidAmount : undefined,
    campaignType: shared.campaignType,
    instagramActorId: shared.instagramActorId,
    targeting: {
      ageMin: shared.ageMin,
      ageMax: shared.ageMax,
      genderMode: shared.genderMode,
      locations: shared.locations,
      interests: shared.interests,
    },
  };
  const creativeOptions = {
    name: campaignName,
    pageId: shared.pageId,
    whatsappNumber: normalizedPhone,
    whatsappMessage: car.whatsappMessage || undefined,
    whatsappGreeting: car.whatsappGreeting || undefined,
    primaryText: car.primaryText,
    headline: car.headline,
    description: car.description || undefined,
    mediaType: car.mediaType,
    imageHash: finalImageHash,
    videoId: finalVideoId,
    thumbnailUrl: finalThumbnailUrl,
  };

  const n8nUrl = await getN8nWebhookUrl();
  if (n8nUrl) {
    onProgress?.("Enviando para o n8n...");
    const callbackId = crypto.randomUUID();
    await triggerN8nCampaign({ callbackId, token, campaignOptions, creativeOptions, adName });
    onProgress?.("Aguardando o n8n criar a campanha...");
    return waitForN8nJob(callbackId, onProgress);
  }

  onProgress?.("Criando campanha e conjunto...");
  const { campaignId, adSetId } = await createCampaignFromScratch({ ...campaignOptions, token });

  onProgress?.("Criando criativo...");
  const creativeId = await createAdCreative(shared.adAccountId, creativeOptions, token);

  onProgress?.("Criando anúncio...");
  await createAd(shared.adAccountId, { name: adName, adSetId, creativeId }, token);

  return campaignId;
}

interface SearchParams {
  client?: string;
  duplicateFrom?: string;
  duplicateFromName?: string;
}

export const Route = createFileRoute("/campaigns/new")({
  head: () => ({
    meta: [{ title: "Nova Campanha — Gestor de Tráfego" }],
  }),
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    client: typeof s.client === "string" ? s.client : undefined,
    duplicateFrom: typeof s.duplicateFrom === "string" ? s.duplicateFrom : undefined,
    duplicateFromName: typeof s.duplicateFromName === "string" ? s.duplicateFromName : undefined,
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
  const [mode, setMode] = useState<"duplicate" | "scratch" | "bulk">(search.duplicateFrom ? "duplicate" : "scratch");
  const [baseCampaignId, setBaseCampaignId] = useState(search.duplicateFrom ?? "");
  const [campaignName, setCampaignName] = useState(
    search.duplicateFromName ? `${search.duplicateFromName} — Cópia` : ""
  );
  // Padrão de nomenclatura fixo (igual ao modo em massa) — tanto pra criar do
  // zero quanto pra duplicar. O usuário ainda pode editar se quiser.
  const [adSetName, setAdSetName] = useState("CA1 - ABERTO");
  const [adName, setAdName] = useState("AD1 - ARTE");
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
  const [placementMode, setPlacementMode] = useState<"advantage_plus" | "manual">("advantage_plus");
  const [bidAmount, setBidAmount] = useState<number | "">("");
  const [platforms, setPlatforms] = useState({ facebook: true, instagram: true });
  const [fbPositions, setFbPositions] = useState(["feed", "story"]);
  const [igPositions, setIgPositions] = useState(["stream", "story"]);

  // ── Step 3: Ad creative ─────────────────────────────────────
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  // Acompanha o padrão fixo (AD1 - ARTE / AD1 - VIDEO) conforme o tipo de mídia
  // muda — só sobrescreve se o campo ainda estiver num dos dois valores padrão,
  // pra não apagar um nome customizado pelo usuário.
  useEffect(() => {
    setAdName((current) =>
      current === "AD1 - ARTE" || current === "AD1 - VIDEO"
        ? `AD1 - ${mediaType === "video" ? "VIDEO" : "ARTE"}`
        : current
    );
  }, [mediaType]);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [adDescription, setAdDescription] = useState("");
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [whatsappGreeting, setWhatsappGreeting] = useState("");

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
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  // ── Criar em massa ────────────────────────────────────────────
  const [cars, setCars] = useState<BulkCar[]>([makeEmptyBulkCar()]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<
    Record<string, { status: "idle" | "running" | "done" | "error"; message?: string; campaignId?: string }>
  >({});

  const updateCar = (id: string, patch: Partial<BulkCar>) => {
    setCars((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const addCar = () => setCars((prev) => [...prev, makeEmptyBulkCar()]);
  const removeCar = (id: string) => setCars((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));

  const handleBulkFileSelect = useCallback((carId: string, mediaType: "image" | "video", file: File) => {
    if (mediaType === "image") {
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        if (img.width < 500 || img.height < 500) {
          toast.error(`Imagem muito pequena: ${img.width}×${img.height}px. Meta exige mínimo 500×500px.`, { duration: 6000 });
          URL.revokeObjectURL(url);
          return;
        }
        updateCar(carId, { mediaFile: file, mediaPreview: url });
      };
      img.src = url;
    } else {
      const url = URL.createObjectURL(file);
      updateCar(carId, { mediaFile: file, mediaPreview: url });
    }
  }, []);

  const bulkValid =
    !!clientId &&
    budget > 0 &&
    !!pageId &&
    cars.every((c) => !!c.mediaFile && !!c.name.trim() && !!c.primaryText && !!c.headline);

  const runBulk = async () => {
    if (!selectedClient) { toast.error("Selecione um cliente."); return; }
    const token = await getMetaToken(selectedClient.id);
    if (!token) { toast.error("Token Meta não encontrado. Acesse Configurações."); return; }

    setBulkRunning(true);
    setBulkResults(Object.fromEntries(cars.map((c) => [c.id, { status: "idle" as const }])));

    const shared: BulkSharedConfig = {
      adAccountId: selectedClient.meta_ad_account_id,
      pageId,
      whatsappNumber,
      campaignType,
      budget,
      placementMode,
      platforms,
      fbPositions,
      igPositions,
      bidAmount,
      instagramActorId,
      ageMin,
      ageMax,
      genderMode,
      locations,
      interests,
    };

    for (const car of cars) {
      setBulkResults((prev) => ({ ...prev, [car.id]: { status: "running", message: "Iniciando..." } }));
      try {
        const campaignId = await createOneBulkCampaign(shared, car, token, (msg) => {
          setBulkResults((prev) => ({ ...prev, [car.id]: { status: "running", message: msg } }));
        });
        setBulkResults((prev) => ({ ...prev, [car.id]: { status: "done", campaignId } }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        setBulkResults((prev) => ({ ...prev, [car.id]: { status: "error", message: msg } }));
      }
    }

    setBulkRunning(false);
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  };

  // ── Data ────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-all"],
    queryFn: fetchAllClients,
  });

  const selectedClient = clients.find((c) => c.id === clientId);

  // Pre-fill ID da Página / WhatsApp quando o cliente já vem pré-selecionado pela URL
  // (handleClientChange só roda quando o usuário troca o cliente manualmente)
  useEffect(() => {
    if (!search.client || !selectedClient) return;
    setPageId((prev) => prev || selectedClient.meta_page_id || "");
    setWhatsappNumber((prev) => prev || selectedClient.meta_whatsapp_number || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id]);

  // ── n8n job polling ─────────────────────────────────────────
  const { data: jobStatus } = useQuery({
    queryKey: ["n8n-job", pendingJobId],
    queryFn: () => pollN8nJob(pendingJobId!),
    enabled: !!pendingJobId,
    refetchInterval: 4000,
  });

  useEffect(() => {
    if (!jobStatus || !pendingJobId) return;
    if (jobStatus.status === "done") {
      toast.dismiss("n8n-progress");
      toast.success("Anúncio criado com sucesso pelo n8n!", { duration: 10000 });
      setPendingJobId(null);
    } else if (jobStatus.status === "error") {
      toast.dismiss("n8n-progress");
      toast.error(`Erro no n8n: ${jobStatus.errorMessage ?? "Erro desconhecido"}`, { duration: 20000 });
      setPendingJobId(null);
    }
  }, [jobStatus, pendingJobId]);

  // Aviso brando aos 60s (sem parar de checar — vídeo pode demorar mais que isso pra processar)
  useEffect(() => {
    if (!pendingJobId) return;
    const timer = setTimeout(() => {
      toast.info("Ainda processando… pode levar mais alguns minutos, especialmente com vídeo.", { id: "n8n-progress", duration: 15000 });
    }, 60 * 1000);
    return () => clearTimeout(timer);
  }, [pendingJobId]);

  // Timeout definitivo: se o n8n não responder em 5min, aí sim desiste e libera o botão
  useEffect(() => {
    if (!pendingJobId) return;
    const timer = setTimeout(() => {
      toast.dismiss("n8n-progress");
      toast.error("O n8n não respondeu a tempo. Verifique o workflow — o anúncio pode ter sido criado mesmo assim.", { duration: 20000 });
      setPendingJobId(null);
    }, 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [pendingJobId]);

  // Pre-fill form when base campaign is selected in duplicate mode
  useEffect(() => {
    if (!baseCampaignId || mode !== "duplicate") return;
    let cancelled = false;
    const load = async () => {
      setPrefillLoading(true);
      try {
        const token = await getMetaToken(selectedClient?.id);
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
      const token = await getMetaToken(selectedClient?.id);
      if (!token || !selectedClient) return [];
      return fetchCampaigns(selectedClient.meta_ad_account_id, token, "maximum");
    },
    enabled: !!selectedClient && mode === "duplicate",
  });

  const { data: templates = [], isError: templatesError } = useQuery({
    queryKey: ["conversation-templates", clientId],
    queryFn: () => fetchConversationTemplates(clientId),
    enabled: !!clientId,
    retry: false,
  });

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const saveTemplateMutation = useMutation({
    mutationFn: (data: { id?: string; name: string; greeting: string; preMessage: string }) =>
      upsertConversationTemplate({
        id: data.id,
        clientId,
        name: data.name,
        greeting: data.greeting || null,
        pre_message: data.preMessage || null,
      }),
    onSuccess: (tpl) => {
      queryClient.invalidateQueries({ queryKey: ["conversation-templates", clientId] });
      setSelectedTemplateId(tpl.id);
      setWhatsappMessage(tpl.pre_message ?? "");
      setWhatsappGreeting(tpl.greeting ?? "");
      setTemplateMode("select");
      toast.success("Modelo salvo.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar modelo"),
  });

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplateId(id);
    const t = templates.find((t) => t.id === id);
    if (t) {
      setWhatsappMessage(t.pre_message ?? "");
      setWhatsappGreeting(t.greeting ?? "");
    }
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
    setSelectedTemplateId("");
    setWhatsappMessage("");
    setWhatsappGreeting("");
  };

  const handleBaseCampaignChange = (id: string) => {
    setBaseCampaignId(id);
    const campaign = clientCampaigns.find((c) => c.id === id);
    if (campaign) {
      setCampaignName(`${campaign.name} — Cópia`);
      // Nome do conjunto/anúncio seguem o padrão fixo (CA1 - ABERTO / AD1 - ARTE|VIDEO)
      // já pré-preenchido — não sobrescreve aqui pra não perder edição manual do usuário.
    }
  };

  const handleFileSelect = useCallback((file: File) => {
    if (file.type.startsWith("image/")) {
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        if (img.width < 500 || img.height < 500) {
          toast.error(
            `Imagem muito pequena: ${img.width}×${img.height}px. Meta exige mínimo 500×500px.`,
            { duration: 6000 }
          );
          URL.revokeObjectURL(url);
          return;
        }
        setMediaFile(file);
        setMediaPreview(url);
      };
      img.src = url;
    } else {
      setMediaFile(file);
      const url = URL.createObjectURL(file);
      setMediaPreview(url);
    }
  }, []);

  // ── Duplicate mutation ───────────────────────────────────────
  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken(selectedClient?.id);
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
          selectedClient.meta_whatsapp_number ?? undefined,
          adSetName || undefined,
          adName || undefined
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
      const token = await getMetaToken(selectedClient?.id);
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
            finalVideoId = await uploadAdVideo(selectedClient.meta_ad_account_id, mediaFile, token, progress);
            finalImageHash = undefined;
            finalThumbnailUrl = (await waitForVideoReady(finalVideoId, token, progress)) ?? existingThumbnailUrl;
          }
        }

        const normalizedPhone = (whatsappNumber || "").replace(/\D/g, "");
        const campaignOptions = {
          name: campaignName,
          adSetName: adSetName || campaignName,
          adAccountId: selectedClient.meta_ad_account_id,
          pageId,
          whatsappNumber: whatsappNumber || undefined,
          dailyBudget: budget,
          placementMode,
          placements: platforms,
          fbPositions: platforms.facebook ? fbPositions : [],
          igPositions: platforms.instagram ? igPositions : [],
          bidAmount: placementMode === "manual" && bidAmount !== "" ? bidAmount : undefined,
          campaignType,
          instagramActorId,
          targeting: { ageMin, ageMax, genderMode, locations, interests },
        };
        const creativeOptions = {
          name: campaignName,
          pageId,
          whatsappNumber: normalizedPhone,
          whatsappMessage: whatsappMessage || undefined,
          whatsappGreeting: whatsappGreeting || undefined,
          primaryText,
          headline,
          description: adDescription || undefined,
          mediaType,
          imageHash: finalImageHash,
          videoId: finalVideoId,
          thumbnailUrl: finalThumbnailUrl,
        };

        const n8nUrl = await getN8nWebhookUrl();
        if (n8nUrl) {
          progress("Enviando para o n8n...");
          const callbackId = crypto.randomUUID();
          await triggerN8nCampaign({ callbackId, token, campaignOptions, creativeOptions, adName: adName || campaignName });
          toast.dismiss(pid);
          toast.loading("Criando anúncio via n8n...", { id: "n8n-progress", duration: Infinity });
          return { n8nJobId: callbackId };
        }

        progress("Criando campanha e conjunto...");
        const { campaignId, adSetId } = await createCampaignFromScratch({ ...campaignOptions, token });

        progress("Criando criativo...");
        const creativeId = await createAdCreative(
          selectedClient.meta_ad_account_id,
          creativeOptions,
          token
        );

        progress("Criando anúncio...");
        await createAd(
          selectedClient.meta_ad_account_id,
          { name: adName || campaignName, adSetId, creativeId },
          token
        );

        toast.dismiss(pid);
        return campaignId;
      } catch (err) {
        toast.dismiss(pid);
        throw err;
      }
    },
    onSuccess: (result) => {
      if (!result) return;
      if (typeof result === "object" && "n8nJobId" in result) {
        setPendingJobId(result.n8nJobId);
      } else {
        setCreatedId(result);
      }
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao criar campanha";
      console.error("[campaigns] erro ao criar anúncio:", e);
      toast.error(msg, {
        duration: 20000,
        action: { label: "Ver diagnóstico", onClick: () => navigate({ to: "/diagnostico-meta" }) },
      });
    },
  });

  // ── Validation ───────────────────────────────────────────────
  const step1ValidDuplicate = !!clientId && !!campaignName && !!baseCampaignId;
  const step1ValidScratch = !!clientId && !!campaignName && budget > 0;
  const step1ValidBulk = !!clientId && budget > 0 && !!pageId;
  const hasMedia = !!mediaFile || !!(existingVideoId || existingImageHash);
  const step3Valid = hasMedia && !!primaryText && !!headline;

  // ── Success screen ───────────────────────────────────────────
  if (createdId && selectedClient) {
    const metaUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${selectedClient.meta_ad_account_id.replace("act_", "")}`;
    return (
      <AppShell>
        <div className="px-4 md:px-8 py-12 max-w-xl mx-auto text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-status-on-target/20 flex items-center justify-center mb-4">
            <Check className="h-7 w-7 text-status-on-target" />
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
              setAdSetName("CA1 - ABERTO");
              setAdName(`AD1 - ${mediaType === "video" ? "VIDEO" : "ARTE"}`);
              setBaseCampaignId("");
              setMediaFile(null);
              setMediaPreview(null);
              setPrimaryText("");
              setHeadline("");
              setAdDescription("");
              setWhatsappMessage("");
              setWhatsappGreeting("");
              // Sempre volta pro número cadastrado do cliente — nunca herda o
              // número digitado na campanha anterior (evita lead indo pro
              // número errado quando o usuário esquece de trocar de novo).
              setWhatsappNumber(selectedClient?.meta_whatsapp_number || "");
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
        {(mode === "scratch" || mode === "bulk") && <div className="flex items-center gap-2 mb-8">
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
                    ? "text-status-on-target cursor-pointer hover:bg-status-on-target/10"
                    : "text-muted-foreground",
                ].join(" ")}
              >
                <span className={[
                  "inline-flex h-5 w-5 shrink-0 rounded-full items-center justify-center text-xs font-semibold",
                  step === n ? "bg-white/20" : step > n ? "bg-status-on-target text-white" : "bg-muted",
                ].join(" ")}>
                  {step > n ? <Check className="h-3 w-3" /> : n}
                </span>
                {n === 1 ? "Campanha" : n === 2 ? "Conjunto" : mode === "bulk" ? "Carros" : "Anúncio"}
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
                    setMode(v as "duplicate" | "scratch" | "bulk");
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
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="bulk" id="bulk" />
                    <Label htmlFor="bulk" className="font-normal cursor-pointer">Criar em massa</Label>
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
                              <span className={`inline-block w-2 h-2 rounded-full ${c.status === "ACTIVE" ? "bg-status-on-target" : "bg-muted-foreground"}`} />
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

              {mode === "bulk" && (
                <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
                  No modo em massa, o nome da campanha/conjunto/anúncio é gerado automaticamente a partir do nome de cada carro, no passo 3.
                </p>
              )}

              {mode !== "bulk" && (
                <div className="space-y-2">
                  <Label>Nome da campanha</Label>
                  <Input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder={mode === "duplicate" ? "Preenchido ao selecionar a base" : "Ex: [ENG-MSG] [CIVIC 2024]"}
                  />
                </div>
              )}

              {mode !== "bulk" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nome do conjunto de anúncios</Label>
                    <Input
                      value={adSetName}
                      onChange={(e) => setAdSetName(e.target.value)}
                      placeholder="Ex: CA1 - ABERTO"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Nome do anúncio</Label>
                    <Input
                      value={adName}
                      onChange={(e) => setAdName(e.target.value)}
                      placeholder="Ex: AD1 - ARTE"
                    />
                  </div>
                </div>
              )}
              {mode === "duplicate" && (
                <p className="text-xs text-muted-foreground -mt-2">
                  Se a campanha base tiver mais de um conjunto, esses nomes são ignorados e os nomes originais são mantidos.
                </p>
              )}

              {(mode === "scratch" || mode === "bulk") && (
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
                    <Label>Configuração</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPlacementMode("advantage_plus")}
                        className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          placementMode === "advantage_plus" ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="font-medium">Automático <span className="text-xs text-muted-foreground font-normal">(recomendado)</span></div>
                        <div className="text-xs text-muted-foreground mt-0.5">Posicionamentos Advantage+ e lance automático — configuração simplificada da Meta</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlacementMode("manual")}
                        className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          placementMode === "manual" ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="font-medium">Manual</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Você escolhe posicionamentos e pode definir um limite de lance</div>
                      </button>
                    </div>
                  </div>

                  {placementMode === "manual" && (
                    <div className="space-y-2">
                      <Label>Limite de lance (R$) <span className="text-muted-foreground font-normal text-xs ml-1">opcional</span></Label>
                      <Input
                        type="number"
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value === "" ? "" : Number(e.target.value))}
                        min={0}
                        step={0.5}
                        placeholder="Deixe em branco para lance automático"
                      />
                    </div>
                  )}

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
                          <span className="ml-1.5 text-xs text-status-on-target font-normal">pré-preenchido</span>
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
                          whatsappNumber.replace(/\D/g, "") === selectedClient.meta_whatsapp_number.replace(/\D/g, "") ? (
                            <span className="ml-1.5 text-xs text-status-on-target font-normal">= cadastrado</span>
                          ) : (
                            <span className="ml-1.5 text-xs text-status-attention font-normal">
                              ⚠ diferente do cadastrado ({selectedClient.meta_whatsapp_number})
                            </span>
                          )
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
                <Button onClick={() => setStep(2)} disabled={mode === "bulk" ? !step1ValidBulk : !step1ValidScratch}>
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

              {placementMode === "advantage_plus" && (
                <p className="text-xs text-muted-foreground">Automático (Advantage+) — definido no Passo 1.</p>
              )}

              {placementMode === "manual" && (
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
              )}

              {placementMode === "manual" && platforms.facebook && (
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

              {placementMode === "manual" && platforms.instagram && (
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
        {step === 3 && mode !== "bulk" && (
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
                      <span>Não foi possível carregar os templates de conversa. Tente novamente em instantes.</span>
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
                disabled={!step3Valid || createMutation.isPending || !!pendingJobId}
                className="px-6"
              >
                {(createMutation.isPending || pendingJobId) ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Criando...</>
                ) : "Criar Campanha"}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3 (massa): Configuração da conversa + lista de carros ── */}
        {step === 3 && mode === "bulk" && (
          <div className="space-y-5">
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <span>
                Todos os carros abrirão o WhatsApp:{" "}
                <strong className="text-foreground">{whatsappNumber || "não configurado"}</strong>
                {" "}— a mensagem de saudação é configurada individualmente em cada carro abaixo.
              </span>
            </div>

            <div className="space-y-3">
              {cars.map((car, i) => {
                const result = bulkResults[car.id];
                return (
                  <Card key={car.id} className="p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <SectionTitle>Carro {i + 1}</SectionTitle>
                      <div className="flex items-center gap-2">
                        {result?.status === "running" && (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {result.message}
                          </span>
                        )}
                        {result?.status === "done" && (
                          <span className="flex items-center gap-1.5 text-xs text-status-on-target">
                            <Check className="h-3.5 w-3.5" />
                            Criada
                          </span>
                        )}
                        {result?.status === "error" && (
                          <span className="flex items-center gap-1.5 text-xs text-status-critical" title={result.message}>
                            <AlertCircle className="h-3.5 w-3.5" />
                            Falhou
                          </span>
                        )}
                        {cars.length > 1 && !bulkRunning && (
                          <button onClick={() => removeCar(car.id)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {result?.status === "error" && (
                      <p className="text-xs text-status-critical bg-status-critical/10 rounded-md p-2.5">{result.message}</p>
                    )}
                    {result?.status === "done" && result.campaignId && (
                      <a
                        href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${result.campaignId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Abrir no Meta
                      </a>
                    )}

                    <div className="space-y-2">
                      <Label>Nome do carro</Label>
                      <Input
                        value={car.name}
                        onChange={(e) => updateCar(car.id, { name: e.target.value })}
                        placeholder="Ex: Onix 2022"
                        disabled={bulkRunning}
                      />
                    </div>

                    <div className="flex gap-2">
                      {(["image", "video"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={bulkRunning}
                          onClick={() => updateCar(car.id, { mediaType: t, mediaFile: null, mediaPreview: null })}
                          className={[
                            "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors",
                            car.mediaType === t
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-border/80",
                          ].join(" ")}
                        >
                          {t === "image" ? <Image className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                          {t === "image" ? "Imagem" : "Vídeo"}
                        </button>
                      ))}
                    </div>

                    <UploadZone
                      mediaType={car.mediaType}
                      file={car.mediaFile}
                      preview={car.mediaPreview}
                      onFile={(f) => handleBulkFileSelect(car.id, car.mediaType, f)}
                      onClear={() => updateCar(car.id, { mediaFile: null, mediaPreview: null })}
                    />

                    <div className="space-y-2">
                      <Label>Texto principal</Label>
                      <Textarea
                        value={car.primaryText}
                        onChange={(e) => updateCar(car.id, { primaryText: e.target.value })}
                        placeholder="Texto que aparece acima do criativo..."
                        className="min-h-[90px] resize-none"
                        disabled={bulkRunning}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Título</Label>
                      <Input
                        value={car.headline}
                        onChange={(e) => updateCar(car.id, { headline: e.target.value })}
                        placeholder="Ex: Chevrolet Onix 2022 — R$ 74.900"
                        disabled={bulkRunning}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Descrição <span className="text-muted-foreground font-normal text-xs ml-1">opcional</span></Label>
                      <Input
                        value={car.description}
                        onChange={(e) => updateCar(car.id, { description: e.target.value })}
                        placeholder="Ex: Consulte condições de financiamento"
                        disabled={bulkRunning}
                      />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label>Mensagem de saudação <span className="text-muted-foreground font-normal text-xs ml-1">opcional</span></Label>
                      <Textarea
                        value={car.whatsappGreeting}
                        onChange={(e) => updateCar(car.id, { whatsappGreeting: e.target.value })}
                        placeholder="Mensagem enviada automaticamente ao abrir a conversa..."
                        className="min-h-[70px] resize-none"
                        disabled={bulkRunning}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Mensagem pré-pronta <span className="text-muted-foreground font-normal text-xs ml-1">opcional</span></Label>
                      <Textarea
                        value={car.whatsappMessage}
                        onChange={(e) => updateCar(car.id, { whatsappMessage: e.target.value })}
                        placeholder="Texto que já vem preenchido no campo de mensagem do WhatsApp..."
                        className="min-h-[70px] resize-none"
                        disabled={bulkRunning}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>

            <Button variant="outline" onClick={addCar} disabled={bulkRunning} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Adicionar carro
            </Button>

            {Object.keys(bulkResults).length > 0 && !bulkRunning && (
              <div className="rounded-lg border border-border p-3 text-sm">
                {Object.values(bulkResults).filter((r) => r.status === "done").length} de {cars.length} campanhas criadas com sucesso.
              </div>
            )}

            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={() => setStep(2)} disabled={bulkRunning}>← Voltar</Button>
              <Button onClick={runBulk} disabled={!bulkValid || bulkRunning} className="px-6">
                {bulkRunning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Criando campanhas...</>
                ) : `Criar ${cars.length} campanha${cars.length > 1 ? "s" : ""}`}
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
  const [showMap, setShowMap] = useState(false);
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
      {selected.some((l) => l.type === "city") && (
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <MapPin className="h-3 w-3" />
          {showMap ? "Esconder mapa" : "Ver no mapa"}
        </button>
      )}
      {showMap && (
        <Suspense fallback={MAP_FALLBACK}>
          <LocationsMap locations={selected} />
        </Suspense>
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
