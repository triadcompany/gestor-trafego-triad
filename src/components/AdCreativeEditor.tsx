import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Image, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAdWithCreative,
  updateAdCreative,
  type MetaAdCreative,
} from "@/lib/meta";

interface AdCreativeEditorProps {
  adId: string;
  adSetId: string;
  token: string;
}

function extractFields(creative: MetaAdCreative) {
  const link = creative.object_story_spec?.link_data;
  const video = creative.object_story_spec?.video_data;
  const story = link ?? video;

  const primaryText = story?.message ?? creative.body ?? "";
  const headline = (link?.name ?? video?.title) ?? creative.title ?? "";
  const description = story?.description ?? creative.description ?? "";

  const cta = story?.call_to_action;
  const isWhatsApp =
    cta?.type === "WHATSAPP_MESSAGE" ||
    cta?.value?.app_destination === "WHATSAPP";
  const whatsappNumber = cta?.value?.whatsapp_number ?? "";
  const whatsappMessage = link?.call_to_action?.value?.message ?? "";

  return { primaryText, headline, description, isWhatsApp, whatsappNumber, whatsappMessage };
}

export function AdCreativeEditor({ adId, adSetId, token }: AdCreativeEditorProps) {
  const queryClient = useQueryClient();

  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);

  const { data: creative, isLoading, error } = useQuery({
    queryKey: ["creative", adId],
    queryFn: () => fetchAdWithCreative(adId, token),
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!creative?.id) throw new Error("ID do criativo não encontrado.");
      await updateAdCreative(creative.id, { body: primaryText, title: headline, description }, token);
    },
    onSuccess: () => {
      toast.success("Criativo salvo.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["creative", adId] });
      queryClient.invalidateQueries({ queryKey: ["ads", adSetId] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
      if (msg.toLowerCase().includes("published") || msg.toLowerCase().includes("cannot")) {
        toast.error("Este criativo não pode ser editado diretamente. Use o Gerenciador de Anúncios.", { duration: 8000 });
      } else {
        toast.error(msg);
      }
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
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Não foi possível carregar o criativo.
      </div>
    );
  }

  const { isWhatsApp, whatsappNumber, whatsappMessage } = extractFields(creative);

  const metaAdUrl = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=&selected_ad_ids=${adId}`;

  return (
    <div className="space-y-4 py-1">

      {/* Thumbnail */}
      <div className="flex items-start gap-3">
        {creative.thumbnail_url ? (
          <img
            src={creative.thumbnail_url}
            alt="Criativo"
            className="h-20 w-20 rounded-lg object-cover border border-border shrink-0"
          />
        ) : (
          <div className="h-20 w-20 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
            <Image className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-1">Imagem/Vídeo</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Para trocar o criativo, edite no Gerenciador de Anúncios.
          </p>
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
          {whatsappNumber && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Número</Label>
              <p className="text-sm font-medium">{whatsappNumber}</p>
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
        ) : dirty ? "Salvar alterações" : "Sem alterações"}
      </Button>
    </div>
  );
}
