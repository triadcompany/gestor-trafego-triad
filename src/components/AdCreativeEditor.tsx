import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Image, Loader2, AlertCircle, Upload, X, Play } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAdWithCreative,
  updateAdCreative,
  swapAdCreativeMedia,
  fetchVideoSource,
  type MetaAdCreative,
} from "@/lib/meta";
import {
  fetchConversationTemplates,
  upsertConversationTemplate,
  type ConversationTemplate,
} from "@/lib/queries";

interface AdCreativeEditorProps {
  adId: string;
  adSetId: string;
  clientId: string;
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

export function AdCreativeEditor({ adId, adSetId, clientId, token, whatsappNumber }: AdCreativeEditorProps) {
  const queryClient = useQueryClient();

  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);

  const [newMediaFile, setNewMediaFile] = useState<File | null>(null);
  const [newMediaPreview, setNewMediaPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configuração da conversa — sem seleção = mantém a saudação já configurada no anúncio
  const [templateMode, setTemplateMode] = useState<"select" | "new" | "edit">("select");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [whatsappGreeting, setWhatsappGreeting] = useState("");
  const [whatsappPreMessage, setWhatsappPreMessage] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplGreeting, setTplGreeting] = useState("");
  const [tplPreMessage, setTplPreMessage] = useState("");

  const { data: templates = [], isError: templatesError } = useQuery({
    queryKey: ["conversation-templates", clientId],
    queryFn: () => fetchConversationTemplates(clientId),
    enabled: !!clientId,
    retry: false,
  });

  const selectedTemplate = templates.find((t: ConversationTemplate) => t.id === selectedTemplateId) ?? null;

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
      setWhatsappGreeting(tpl.greeting ?? "");
      setWhatsappPreMessage(tpl.pre_message ?? "");
      setTemplateMode("select");
      mark();
      toast.success("Modelo salvo.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar modelo"),
  });

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplateId(id);
    const t = templates.find((t: ConversationTemplate) => t.id === id);
    if (t) {
      setWhatsappGreeting(t.greeting ?? "");
      setWhatsappPreMessage(t.pre_message ?? "");
      mark();
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
  const videoId = creative?.video_id ?? creative?.object_story_spec?.video_data?.video_id ?? null;

  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const { data: videoSource, isLoading: videoLoading, error: videoError } = useQuery({
    queryKey: ["ad-video-source", videoId],
    queryFn: () => fetchVideoSource(videoId!, token),
    enabled: showVideoPlayer && !!videoId,
    retry: false,
  });

  const accept = isVideo
    ? "video/mp4,video/mov,video/avi,video/quicktime"
    : "image/jpeg,image/png,image/gif,image/webp";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewMediaFile(file);
    setNewMediaPreview(URL.createObjectURL(file));
    setDirty(true);
    e.target.value = "";
  };

  const clearNewMedia = () => {
    setNewMediaFile(null);
    if (newMediaPreview) URL.revokeObjectURL(newMediaPreview);
    setNewMediaPreview(null);
  };

  // Um único save: se tem mídia nova selecionada, troca mídia E texto juntos (evita
  // que o texto digitado se perca por trás de um criativo reconstruído com dados antigos).
  // Sem mídia nova, só atualiza o texto.
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!creative?.id) throw new Error("ID do criativo não encontrado.");
      const conversationOverrides = whatsappGreeting
        ? { whatsappGreeting, whatsappMessage: whatsappPreMessage }
        : undefined;
      if (newMediaFile) {
        const pid = "swap-progress";
        await swapAdCreativeMedia(
          adId,
          creative,
          newMediaFile,
          token,
          whatsappNumber,
          (msg) => toast.loading(msg, { id: pid }),
          { body: primaryText, title: headline, description },
          conversationOverrides
        );
        toast.dismiss(pid);
      } else {
        await updateAdCreative(
          adId,
          creative,
          { body: primaryText, title: headline, description },
          token,
          whatsappNumber,
          conversationOverrides
        );
      }
    },
    onSuccess: () => {
      toast.success(
        newMediaFile ? "Criativo e mídia atualizados." : "Criativo atualizado. O anúncio pode entrar em revisão brevemente."
      );
      setDirty(false);
      clearNewMedia();
      queryClient.invalidateQueries({ queryKey: ["creative", adId] });
      queryClient.invalidateQueries({ queryKey: ["ads", adSetId] });
    },
    onError: (e) => {
      toast.dismiss("swap-progress");
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
      if (msg === "ACTIVE_CREATIVE_NO_SPEC") {
        toast.error("Não foi possível obter a estrutura do criativo ativo. Edite diretamente no Meta Ads Manager.", { duration: 10000 });
      } else {
        toast.error(msg, { duration: 8000 });
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
    const metaAdUrl = `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${adId}`;
    return (
      <div className="space-y-2 py-1">
        <div className="flex items-start gap-2 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-status-attention mt-0.5" />
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
            <button
              type="button"
              onClick={() => isVideo && setShowVideoPlayer(true)}
              className="block relative"
              title={isVideo ? "Ver vídeo" : undefined}
            >
              <img
                src={creative.thumbnail_url}
                alt="Criativo"
                className="h-20 w-20 rounded-lg object-cover border border-border"
              />
              {isVideo && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 hover:bg-black/40 transition-colors">
                  <Play className="h-6 w-6 text-white fill-white" />
                </span>
              )}
            </button>
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

      {showVideoPlayer && (
        <div className="rounded-lg border border-border overflow-hidden bg-black">
          {videoLoading ? (
            <div className="h-48 flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
            </div>
          ) : videoError || !videoSource ? (
            <div className="p-3 flex items-center gap-2 text-xs text-muted-foreground bg-card">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-status-attention" />
              Não foi possível carregar o vídeo.
              <a href={metaAdUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto shrink-0">
                Abrir no Meta
              </a>
            </div>
          ) : (
            <video src={videoSource} controls autoPlay className="w-full max-h-80" />
          )}
        </div>
      )}

      {newMediaFile && (
        <p className="text-xs text-muted-foreground -mt-2">
          A nova mídia é salva junto com o texto ao clicar em "Salvar alterações" abaixo.
        </p>
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

      {/* Configuração da conversa */}
      {isWhatsApp && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuração da conversa</p>
            {templateMode === "select" && (
              <button type="button" onClick={openNewTemplate} className="text-xs text-primary hover:underline">
                + Nova
              </button>
            )}
          </div>

          {templateMode === "select" ? (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecionar modelo salvo..." />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t: ConversationTemplate) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedTemplate && (
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={openEditTemplate} className="text-xs px-2 py-1 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                      Editar
                    </button>
                    <button type="button" onClick={openDuplicateTemplate} className="text-xs px-2 py-1 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                      Duplicar
                    </button>
                  </div>
                )}
              </div>

              {templatesError ? (
                <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md p-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>Não foi possível carregar os templates de conversa.</span>
                </div>
              ) : selectedTemplate ? (
                <div className="bg-background rounded-md p-2.5 space-y-2 border border-border">
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
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Sem modelo selecionado — a saudação já configurada no anúncio é mantida.</p>
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
    <div className="space-y-2.5">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Nome do modelo</Label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Ex: Hyundai HB20 2025" className="h-8 text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Saudação <span className="font-normal">opcional</span></Label>
        <Textarea
          value={greeting}
          onChange={(e) => onGreetingChange(e.target.value)}
          placeholder={"🚗 Bem-vindo! Somos especializados em..."}
          className="min-h-[70px] resize-none text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Mensagem pronta <span className="font-normal">opcional</span></Label>
        <Input value={preMessage} onChange={(e) => onPreMessageChange(e.target.value)} placeholder="Ex: Olá, tenho interesse..." className="h-8 text-xs" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={!name.trim() || saving} className="h-7 text-xs">
          {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Salvando...</> : "Salvar"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="h-7 text-xs">Cancelar</Button>
      </div>
    </div>
  );
}
