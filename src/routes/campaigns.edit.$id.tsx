import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Check,
  X,
  Search,
  Loader2,
  Image,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchBaseCampaignPrefill,
  getMetaToken,
  updateMetaObject,
  updateAdCreative,
  swapAdCreativeMedia,
  fetchAdWithCreative,
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
  clientId?: string;
}

export const Route = createFileRoute("/campaigns/edit/$id")({
  head: () => ({
    meta: [{ title: "Editar Campanha — Gestor de Tráfego" }],
  }),
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    clientId: typeof s.clientId === "string" ? s.clientId : undefined,
  }),
  component: EditCampaign,
});

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Campanha", "Conjunto", "Anúncio"];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span
                className={[
                  "h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  done ? "bg-primary text-primary-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </span>
              <span className={`text-xs hidden sm:block ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</span>
            </div>
            {i < 2 && <div className="mx-2 h-px w-8 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function EditCampaign() {
  const { id: campaignId } = Route.useParams();
  const { clientId } = Route.useSearch();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [campaignName, setCampaignName] = useState("");
  const [budget, setBudget] = useState(50);

  // Step 2
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genderMode, setGenderMode] = useState<"all" | "male" | "female">("all");
  const [locations, setLocations] = useState<SelectedLocation[]>([]);
  const [interests, setInterests] = useState<MetaInterest[]>([]);
  const [platforms, setPlatforms] = useState({ facebook: true, instagram: true });
  const [fbPositions, setFbPositions] = useState(["feed", "story"]);
  const [igPositions, setIgPositions] = useState(["stream", "story"]);

  // Step 3
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [adDescription, setAdDescription] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [existingThumbnailUrl, setExistingThumbnailUrl] = useState<string | undefined>();
  const [existingVideoId, setExistingVideoId] = useState<string | undefined>();
  const [existingImageHash, setExistingImageHash] = useState<string | undefined>();
  const [mediaType, setMediaType] = useState<"image" | "video">("image");

  // Prefill data
  const [adsetId, setAdsetId] = useState<string | undefined>();
  const [adId, setAdId] = useState<string | undefined>();
  const [whatsappNumber, setWhatsappNumber] = useState<string | undefined>();
  const [prefillLoaded, setPrefillLoaded] = useState(false);

  const { data: prefill, isLoading: prefillLoading } = useQuery({
    queryKey: ["campaign-prefill-edit", campaignId],
    queryFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token Meta não encontrado.");
      return fetchBaseCampaignPrefill(campaignId, token);
    },
    staleTime: 0,
    retry: 2,
  });

  useEffect(() => {
    if (!prefill || prefillLoaded) return;
    setCampaignName(prefill.name || campaignId);
    setBudget(prefill.dailyBudget);
    setAgeMin(prefill.ageMin);
    setAgeMax(prefill.ageMax);
    setGenderMode(prefill.genderMode);
    setLocations(prefill.locations);
    setInterests(prefill.interests);
    setPlatforms(prefill.platforms);
    setFbPositions(prefill.fbPositions);
    setIgPositions(prefill.igPositions);
    setPrimaryText(prefill.primaryText);
    setHeadline(prefill.headline);
    setAdDescription(prefill.description);
    setMediaType(prefill.mediaType);
    setExistingVideoId(prefill.videoId);
    setExistingImageHash(prefill.imageHash);
    setExistingThumbnailUrl(prefill.thumbnailUrl);
    setAdsetId(prefill.adsetId);
    setAdId(prefill.adId);
    setWhatsappNumber(prefill.whatsappNumber || undefined);
    setPrefillLoaded(true);
  }, [prefill, prefillLoaded, campaignId]);

  const handleFileSelect = useCallback((file: File) => {
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  }, []);

  const finishAndNavigate = () => {
    navigate({
      to: "/clients/$id",
      params: { id: clientId ?? "" },
      search: { openCampaignId: campaignId },
    });
  };

  // Step 1: save campaign name + budget
  const saveCampaignMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token Meta não encontrado.");
      await updateMetaObject(campaignId, {
        name: campaignName,
        daily_budget: String(Math.round(budget * 100)),
      }, token);
    },
    onSuccess: () => {
      toast.success("Campanha atualizada.");
      setStep(2);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar campanha", { duration: 8000 }),
  });

  // Step 2: save targeting
  const saveTargetingMutation = useMutation({
    mutationFn: async () => {
      if (!adsetId) throw new Error("ID do conjunto não encontrado.");
      const token = await getMetaToken();
      if (!token) throw new Error("Token Meta não encontrado.");

      const geoLocations: Record<string, unknown> = {};
      const cities = locations.filter((l) => l.type === "city").map((l) => ({
        key: l.key,
        ...(l.radius ? { radius: l.radius, distance_unit: "kilometer" } : {}),
      }));
      const regions = locations.filter((l) => l.type === "region").map((l) => ({ key: l.key }));
      if (cities.length > 0) geoLocations.cities = cities;
      if (regions.length > 0) geoLocations.regions = regions;
      if (cities.length === 0 && regions.length === 0) geoLocations.countries = ["BR"];

      const genders = genderMode === "all" ? undefined : genderMode === "male" ? [1] : [2];
      const publisherPlatforms: string[] = [];
      if (platforms.facebook) publisherPlatforms.push("facebook");
      if (platforms.instagram) publisherPlatforms.push("instagram");

      const targeting: Record<string, unknown> = {
        age_min: ageMin,
        age_max: ageMax,
        geo_locations: geoLocations,
        publisher_platforms: publisherPlatforms,
        targeting_automation: { advantage_audience: 0 },
      };
      if (genders) targeting.genders = genders;
      if (interests.length > 0) targeting.flexible_spec = [{ interests: interests.map((i) => ({ id: i.id, name: i.name })) }];
      if (platforms.facebook && fbPositions.length > 0) targeting.facebook_positions = fbPositions;
      if (platforms.instagram) {
        let igPos = igPositions;
        if (igPos.includes("explore_home") && !igPos.includes("explore")) igPos = [...igPos, "explore"];
        igPos = igPos.filter((p) => p !== "ig_search");
        targeting.instagram_positions = igPos;
      }

      await updateMetaObject(adsetId, { targeting: JSON.stringify(targeting) }, token);
    },
    onSuccess: () => {
      toast.success("Conjunto atualizado.");
      setStep(3);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar conjunto", { duration: 8000 }),
  });

  // Step 3: save creative text + optional media swap
  const saveCreativeMutation = useMutation({
    mutationFn: async () => {
      if (!adId) throw new Error("ID do anúncio não encontrado.");
      const token = await getMetaToken();
      if (!token) throw new Error("Token Meta não encontrado.");

      if (mediaFile) {
        const pid = "creative-progress";
        await swapAdCreativeMedia(
          adId,
          await fetchAdWithCreative(adId, token),
          mediaFile,
          token,
          whatsappNumber,
          (msg) => toast.loading(msg, { id: pid })
        );
        toast.dismiss(pid);
      } else {
        const creative = await fetchAdWithCreative(adId, token);
        await updateAdCreative(
          adId,
          creative,
          { body: primaryText, title: headline, description: adDescription },
          token,
          whatsappNumber
        );
      }
    },
    onSuccess: () => {
      toast.success("Anúncio atualizado.");
      finishAndNavigate();
    },
    onError: (e) => {
      toast.dismiss("creative-progress");
      toast.error(e instanceof Error ? e.message : "Erro ao salvar anúncio", { duration: 8000 });
    },
  });

  if (prefillLoading && !prefillLoaded) {
    return (
      <AppShell>
        <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={finishAndNavigate}
            className="p-1 rounded-md hover:bg-muted transition-colors"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">Editar campanha duplicada</h1>
            <p className="text-xs text-muted-foreground">ID: {campaignId}</p>
          </div>
        </div>

        <StepIndicator step={step} />

        {/* ── STEP 1: Campanha ── */}
        {step === 1 && (
          <div className="space-y-5">
            <Card className="p-5 space-y-4">
              <SectionTitle>Campanha</SectionTitle>

              <div className="space-y-2">
                <Label>Nome da campanha</Label>
                <Input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="Nome da campanha..."
                />
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
            </Card>

            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={finishAndNavigate}>Cancelar</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Pular
                </Button>
                <Button
                  onClick={() => saveCampaignMutation.mutate()}
                  disabled={!campaignName.trim() || saveCampaignMutation.isPending}
                >
                  {saveCampaignMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</>
                    : "Salvar campanha →"}
                </Button>
              </div>
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
                <LocationSearch selected={locations} onChange={setLocations} />
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

            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>← Voltar</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Pular
                </Button>
                <Button
                  onClick={() => saveTargetingMutation.mutate()}
                  disabled={saveTargetingMutation.isPending || !adsetId}
                >
                  {saveTargetingMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</>
                    : "Salvar conjunto →"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: Anúncio ── */}
        {step === 3 && (
          <div className="space-y-5">
            <Card className="p-5 space-y-4">
              <SectionTitle>Mídia</SectionTitle>

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

              {!mediaFile && existingThumbnailUrl ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <img src={existingThumbnailUrl} alt="Mídia atual" className="w-full max-h-56 object-cover" />
                  <div className="px-4 py-2.5 flex items-center justify-between bg-muted/30">
                    <span className="text-xs text-muted-foreground">
                      {existingVideoId ? "Vídeo atual" : "Imagem atual"}
                    </span>
                    <button
                      onClick={() => {
                        setExistingThumbnailUrl(undefined);
                        setExistingVideoId(undefined);
                        setExistingImageHash(undefined);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground ml-4"
                    >
                      Trocar
                    </button>
                  </div>
                </div>
              ) : (
                <UploadZone
                  mediaType={mediaType}
                  file={mediaFile}
                  preview={mediaPreview}
                  onFile={handleFileSelect}
                  onClear={() => {
                    setMediaFile(null);
                    setMediaPreview(null);
                  }}
                />
              )}
            </Card>

            <Card className="p-5 space-y-4">
              <SectionTitle>Texto do anúncio</SectionTitle>

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
                <Label>Título</Label>
                <Input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Título do anúncio..."
                />
              </div>

              <div className="space-y-2">
                <Label>Descrição <span className="text-muted-foreground font-normal text-xs ml-1">opcional</span></Label>
                <Input
                  value={adDescription}
                  onChange={(e) => setAdDescription(e.target.value)}
                  placeholder="Descrição complementar..."
                />
              </div>
            </Card>

            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={() => setStep(2)}>← Voltar</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={finishAndNavigate}>
                  Pular
                </Button>
                <Button
                  onClick={() => saveCreativeMutation.mutate()}
                  disabled={saveCreativeMutation.isPending || !adId}
                >
                  {saveCreativeMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</>
                    : "Salvar anúncio"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Location search ─────────────────────────────────────────────

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

  const add = (r: MetaLocationResult) => {
    onChange([...selected, { key: r.key, name: r.name, type: r.type as "city" | "region" }]);
    setResults([]);
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

// ── Interest search ─────────────────────────────────────────────

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

// ── Upload zone ─────────────────────────────────────────────────

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
        {mediaType === "video" ? (
          <video src={preview} controls className="w-full max-h-56 object-contain bg-black" />
        ) : (
          <img src={preview} alt="Preview" className="w-full max-h-56 object-cover" />
        )}
        <div className="px-4 py-2.5 flex items-center justify-between bg-muted/30">
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{file.name}</span>
          <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground ml-4 shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={[
        "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30",
      ].join(" ")}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        {mediaType === "image" ? <Image className="h-8 w-8" /> : <Video className="h-8 w-8" />}
        <p className="text-sm">Clique ou arraste {mediaType === "image" ? "uma imagem" : "um vídeo"} aqui</p>
        <p className="text-xs">{mediaType === "image" ? "JPG, PNG, GIF, WEBP" : "MP4, MOV, AVI"}</p>
      </div>
    </div>
  );
}
