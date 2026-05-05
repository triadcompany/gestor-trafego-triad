import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Image, Loader2, AlertCircle, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAdWithCreative,
  updateAdCreative,
  swapAdCreativeMedia,
  type MetaAdCreative,
} from "@/lib/meta";

interface AdCreativeEditorProps {
  adId: string;
  adSetId: string;
  token: string;
  whatsappNumber?: string;
}

function extractFields(creative: MetaAdCreative) {
  const link = creative.object_story_spec?.link_data;
  const video = creative.object_story_spec?.video_data;
  const story = link ?? video;
  const feed = creative.asset_feed_spec;

  const primaryText = story?.message ?? feed?.bodies?.[0]?.text ?? creative.body ?? "";
  const headline = (link?.name ?? video?.title) ?? feed?.titles?.[0]?.text ?? creative.title ?? "";
  const description = story?.description ?? feed?.descriptions?.[0]?.text ?? creative.description ?? "";

  const cta = story?.call_to_action;
  const isWhatsApp =
    cta?.type === "WHATSAPP_MESSAGE" ||
    cta?.value?.app_destination === "WHATSAPP";
  const whatsappNumber = cta?.value?.whatsapp_number ?? "";
  const whatsappMessage = link?.call_to_action?.value?.message ?? "";

  return { primaryText, headline, description, isWhatsApp, whatsappNumber, whatsappMessage };
}

export function AdCreativeEditor({ adId, adSetId, token, whatsappNumber }: AdCreativeEditorProps) {
  const queryClient = useQueryClient();

  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);

  const [newMediaFile, setNewMediaFile] = useState<File | null>(null);
  const [newMediaPreview, setNewMediaPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: creative, isLoading, error } = useQuery({
    queryKey: ["creative", adId],
    queryFn: () => fetchAdWithCreative(adId, token),
    retry: false,
  });

  useEffect(() => {
    if (!creative) return;
    const { primaryText: pt, headline: hl, description: desc } = extractFields(creative);
    setPrimaryText(pt);
    setHeadline(hl);
    setDescription(desc);
    setDirty(false);
  }, [creative]);

  const mark = () => setDirty(true);

  const isVideo = !!(
    creative?.video_id ||
    creative?.object_story_spec?.video_data?.video_id
  );
  const accept = isVideo
    ? "video/mp4,video/mov,video/avi,video/quicktime"
    : "image/jpeg,image/png,image/gif,image/webp";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewMediaFile(file);
    setNewMediaPreview(URL.createObjectURL(file));
    e.target.value = "";
  };

  const clearNewMedia = () => {
    setNewMediaFile(null);
    if (newMediaPreview) URL.revokeObjectURL(newMediaPreview);
    setNewMediaPreview(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!creative?.id) throw new Error("ID do criativo não encontrado.");
      await updateAdCreative(adId, creative, { body: primaryText, title: headline, description }, token, whatsappNumber);
    },
    onSuccess: () => {
      toast.success("Criativo atualizado. O anúncio pode entrar em revisão brevemente.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["creative", adId] });
      queryClient.invalidateQueries({ queryKey: ["ads", adSetId] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
      if (msg === "ACTIVE_CREATIVE_NO_SPEC") {
        toast.error("Não foi possível obter a estrutura do criativo ativo. Edite diretamente no Meta Ads Manager.", { duration: 10000 });
      } else {
        toast.error(msg, { duration: 8000 });
      }
    },
  });

  const swapMutation = useMutation({
    mutationFn: async () => {
      if (!creative || !newMediaFile) throw new Error("Nenhum arquivo selecionado.");
      const pid = "swap-progress";
      await swapAdCreativeMedia(adId, creative, newMediaFile, token, whatsappNumber, (msg) =>
        toast.loading(msg, { id: pid })
      );
      toast.dismiss(pid);
    },
    onSuccess: () => {
      toast.success("Mídia atualizada com sucesso.");
      clearNewMedia();
      queryClient.invalidateQueries({ queryKey: ["creative", adId] });
      queryClient.invalidateQueries({ queryKey: ["ads", adSetId] });
    },
    onError: (e) => {
      toast.dismiss("swap-progress");
      toast.error(e instanceof Error ? e.message : "Erro ao trocar mídia", { duration: 8000 });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2.5">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }

  if (error || !creative) {
    const metaAdUrl = `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${adId}`;
    return (
      <div className="space-y-2 py-1">
        <div className="flex items-start gap-2 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <div>
            <p className="text-muted-foreground text-sm">Não foi possível carregar o criativo.</p>
            {error && (
              <p className="text-xs text-muted-foreground/60 mt-1 break-all">
                {error instanceof Error ? error.message : String(error)}
              </p>
            )}
          </div>
        </div>
        <a
          href={metaAdUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Abrir anúncio no Meta Ads Manager
        </a>
      </div>
    );
  }

  const { isWhatsApp, whatsappNumber: creativeWhatsappNumber, whatsappMessage } = extractFields(creative);
  const metaAdUrl = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=&selected_ad_ids=${adId}`;

  return (
    <div className="space-y-4 py-1">

      {/* Thumbnail + media swap */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {newMediaPreview ? (
            isVideo ? (
              <video
                src={newMediaPreview}
                className="h-20 w-20 rounded-lg object-cover border-2 border-primary"
                muted
              />
            ) : (
              <img
                src={newMediaPreview}
                alt="Nova mídia"
                className="h-20 w-20 rounded-lg object-cover border-2 border-primary"
              />
            )
          ) : creative.thumbnail_url ? (
            <img
              src={creative.thumbnail_url}
              alt="Criativo"
              className="h-20 w-20 rounded-lg object-cover border border-border"
            />
          ) : (
            <div className="h-20 w-20 rounded-lg border border-border bg-muted flex items-center justify-center">
              <Image className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute -bottom-1.5 -right-1.5 h-6 w-6 rounded-full bg-primary flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
            title="Trocar mídia"
          >
            <Upload className="h-3 w-3 text-primary-foreground" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-1">
            {isVideo ? "Vídeo" : "Imagem"}
          </p>
          {newMediaFile ? (
            <div className="flex items-start gap-1.5">
              <p className="text-xs text-foreground leading-tight flex-1 break-all">{newMediaFile.name}</p>
              <button onClick={clearNewMedia} className="shrink-0 mt-0.5">
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Clique em <Upload className="h-3 w-3 inline-block mx-0.5" /> para trocar a mídia.
            </p>
          )}
          <a
            href={metaAdUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary mt-1.5 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir no Meta
          </a>
        </div>
      </div>

      {/* Save new media */}
      {newMediaFile && (
        <Button
          onClick={() => swapMutation.mutate()}
          disabled={swapMutation.isPending}
          className="w-full"
          size="sm"
          variant="secondary"
        >
          {swapMutation.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Enviando mídia...</>
          ) : (
            `Salvar ${isVideo ? "vídeo" : "imagem"}`
          )}
        </Button>
      )}

      {/* Primary text */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Texto principal</Label>
        <Textarea
          value={primaryText}
          onChange={(e) => { setPrimaryText(e.target.value); mark(); }}
          className="text-sm resize-none min-h-[80px]"
          placeholder="Texto que aparece acima do criativo..."
        />
      </div>

      {/* Headline */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Título</Label>
        <Input
          value={headline}
          onChange={(e) => { setHeadline(e.target.value); mark(); }}
          className="h-8 text-sm"
          placeholder="Título do anúncio..."
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Descrição</Label>
        <Input
          value={description}
          onChange={(e) => { setDescription(e.target.value); mark(); }}
          className="h-8 text-sm"
          placeholder="Descrição complementar..."
        />
      </div>

      {/* WhatsApp section */}
      {isWhatsApp && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Modelo de mensagem WhatsApp</p>
          {(creativeWhatsappNumber || whatsappNumber) && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Número</Label>
              <p className="text-sm font-medium">{creativeWhatsappNumber || whatsappNumber}</p>
            </div>
          )}
          {whatsappMessage ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Mensagem pré-preenchida</Label>
              <div className="text-sm bg-background rounded-md px-3 py-2 border border-border whitespace-pre-wrap leading-relaxed">
                {whatsappMessage}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Mensagem configurada diretamente no número do WhatsApp.
              <a href={metaAdUrl} target="_blank" rel="noopener noreferrer" className="text-primary ml-1 hover:underline inline-flex items-center gap-0.5">
                Editar no Meta <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </p>
          )}
        </div>
      )}

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={!dirty || saveMutation.isPending}
        className="w-full"
        size="sm"
      >
        {saveMutation.isPending ? (
          <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Salvando...</>
        ) : dirty ? "Salvar alterações de texto" : "Sem alterações"}
      </Button>
    </div>
  );
}
