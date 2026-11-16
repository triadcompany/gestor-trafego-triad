import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, FolderPlus, ImagePlus, Layers, Megaphone, PlusSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WhatsappNumberPicker } from "@/components/WhatsappNumberPicker";
import { getN8nMetaWriter } from "@/lib/n8n";
import {
  createAdInAdSet,
  createAdSetInCampaign,
  duplicateAd,
  duplicateAdSet,
  fetchAdSets,
  fetchAdSetWhatsappNumber,
  fetchAds,
  fetchCampaigns,
  fetchPageInstagramUserId,
  getMetaToken,
  uploadAdImage,
  uploadAdVideo,
  waitForVideoReady,
} from "@/lib/meta";
import type { ClientRow } from "@/lib/queries";

export type CreateLevel = "campanha" | "conjunto" | "anuncio";

// ── Escolha do que criar ─────────────────────────────────────────────────────

const LEVELS: Array<{ value: CreateLevel; title: string; hint: string; icon: typeof Megaphone }> = [
  { value: "campanha", title: "Campanha", hint: "Cria a estrutura toda: campanha, conjunto e anúncio.", icon: Megaphone },
  { value: "conjunto", title: "Conjunto", hint: "Adiciona um conjunto a uma campanha que já existe.", icon: Layers },
  { value: "anuncio", title: "Anúncio", hint: "Adiciona um anúncio a um conjunto que já existe.", icon: PlusSquare },
];

export function LevelPicker({ value, onChange }: { value: CreateLevel; onChange: (v: CreateLevel) => void }) {
  return (
    <div className="mb-6">
      <p className="text-sm font-medium mb-2">O que você quer criar?</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {LEVELS.map((l) => {
          const active = l.value === value;
          const Icon = l.icon;
          return (
            <button
              key={l.value}
              type="button"
              onClick={() => onChange(l.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <span className="text-sm font-semibold">{l.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{l.hint}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Peças de layout ──────────────────────────────────────────────────────────

function Step({ n, title, hint, disabled, children }: { n: number; title: string; hint?: string; disabled?: boolean; children: ReactNode }) {
  return (
    <Card className={`p-5 space-y-3 transition-opacity ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{n}</span>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="space-y-3 pl-9">{children}</div>
    </Card>
  );
}

function HowToggle({ value, onChange, labels }: { value: "novo" | "duplicar"; onChange: (v: "novo" | "duplicar") => void; labels: [string, string] }) {
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5">
      {(["novo", "duplicar"] as const).map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
            value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v === "novo" ? <FolderPlus className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {labels[i]}
        </button>
      ))}
    </div>
  );
}

interface Option {
  id: string;
  name: string;
  status?: string;
}
const statusTag = (s?: string) => (s === "ACTIVE" ? " · ativo" : s === "PAUSED" ? " · pausado" : "");

function OptionSelect({
  options,
  loading,
  value,
  onChange,
  placeholder,
  emptyText,
}: {
  options: Option[] | undefined;
  loading: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  emptyText: string;
}) {
  if (loading) return <Skeleton className="h-9 w-full" />;
  if (!options || options.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
            {statusTag(o.status)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ClientStep({ clients, clientId, onClientChange }: { clients: ClientRow[]; clientId: string; onClientChange: (id: string) => void }) {
  return (
    <Step n={1} title="Cliente">
      <Select value={clientId || undefined} onValueChange={onClientChange}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione um cliente" />
        </SelectTrigger>
        <SelectContent>
          {clients.filter((c) => c.active).map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Step>
  );
}

// Listas de campanha → conjunto → anúncio do cliente escolhido.
function useStructure(client: ClientRow | undefined, campaignId: string, adSetId: string, withAds: boolean) {
  const campaigns = useQuery({
    queryKey: ["structure-campaigns", client?.id],
    enabled: !!client,
    staleTime: 0,
    queryFn: async () => {
      const token = await getMetaToken(client!.id);
      if (!token) throw new Error("Token Meta não encontrado.");
      const list = await fetchCampaigns(client!.meta_ad_account_id, token, "today");
      return list.filter((c) => c.status === "ACTIVE" || c.status === "PAUSED");
    },
  });
  const adSets = useQuery({
    queryKey: ["structure-adsets", campaignId],
    enabled: !!client && !!campaignId,
    staleTime: 0,
    queryFn: async () => {
      const token = await getMetaToken(client!.id);
      if (!token) throw new Error("Token Meta não encontrado.");
      return (await fetchAdSets(campaignId, token)).filter((a) => a.status === "ACTIVE" || a.status === "PAUSED");
    },
  });
  const ads = useQuery({
    queryKey: ["structure-ads", adSetId],
    enabled: !!client && !!adSetId && withAds,
    staleTime: 0,
    queryFn: async () => {
      const token = await getMetaToken(client!.id);
      if (!token) throw new Error("Token Meta não encontrado.");
      return (await fetchAds(adSetId, token)).filter((a) => a.status === "ACTIVE" || a.status === "PAUSED");
    },
  });
  return { campaigns, adSets, ads };
}

function DoneCard({ title, text, clientId, campaignId, onAgain }: { title: string; text: string; clientId: string; campaignId: string; onAgain: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="py-8 text-center space-y-3">
      <div className="mx-auto h-12 w-12 rounded-full bg-status-on-target/20 flex items-center justify-center">
        <Check className="h-6 w-6 text-status-on-target" />
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{text}</p>
      <div className="flex justify-center gap-2 flex-wrap pt-2">
        <Button onClick={() => navigate({ to: "/campaigns/edit/$id", params: { id: campaignId }, search: { clientId } })}>Abrir campanha no editor</Button>
        <Button variant="outline" onClick={onAgain}>Criar outro</Button>
      </div>
    </div>
  );
}

interface CreatorProps {
  clients: ClientRow[];
  clientId: string;
  onClientChange: (id: string) => void;
}

// ── Conjunto ─────────────────────────────────────────────────────────────────

export function AdSetCreator({ clients, clientId, onClientChange }: CreatorProps) {
  const client = clients.find((c) => c.id === clientId);
  const [how, setHow] = useState<"novo" | "duplicar">("novo");
  const [campaignId, setCampaignId] = useState("");
  const [sourceAdSetId, setSourceAdSetId] = useState("");
  const [targetCampaignId, setTargetCampaignId] = useState("");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [budget, setBudget] = useState<number | "">("");
  const [done, setDone] = useState<{ campaignId: string; text: string } | null>(null);

  const { campaigns, adSets } = useStructure(client, campaignId, "", false);
  const campaign = campaigns.data?.find((c) => c.id === campaignId);
  const destId = how === "duplicar" ? targetCampaignId || campaignId : campaignId;
  const needsBudget = how === "novo" && !!campaign && !campaign.daily_budget;

  const reset = () => {
    setDone(null);
    setName("");
    setSourceAdSetId("");
  };

  const run = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Selecione um cliente.");
      const token = await getMetaToken(client.id);
      if (!token) throw new Error("Token Meta não encontrado. Acesse Configurações.");
      const pid = "structure-progress";
      const writer = await getN8nMetaWriter(token, how === "novo" ? "criar-conjunto" : "duplicar-conjunto", (m) => toast.loading(m, { id: pid }));
      try {
        if (how === "novo") {
          await createAdSetInCampaign(
            {
              adAccountId: client.meta_ad_account_id,
              campaignId,
              name: name.trim(),
              pageId: client.meta_page_id ?? "",
              whatsappNumber: whatsapp,
              dailyBudget: needsBudget && budget !== "" ? budget : undefined,
              token,
            },
            writer
          );
        } else {
          await duplicateAdSet(sourceAdSetId, destId, client.meta_ad_account_id, token, whatsapp.replace(/\D/g, "") || undefined, writer, name);
        }
      } finally {
        toast.dismiss(pid);
      }
    },
    onSuccess: () =>
      setDone({
        campaignId: destId,
        text:
          how === "novo"
            ? "O conjunto foi criado pausado, com público amplo (Brasil, 18–65). Abra a campanha pra ajustar cidades, idade e posicionamentos."
            : "O conjunto foi duplicado pausado, com o mesmo público do original. Confira no editor da campanha antes de ativar.",
      }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar o conjunto.", { duration: 12000 }),
  });

  if (done) return <DoneCard title={how === "novo" ? "Conjunto criado!" : "Conjunto duplicado!"} text={done.text} clientId={clientId} campaignId={done.campaignId} onAgain={reset} />;

  const valid =
    !!client &&
    !!campaignId &&
    (how === "novo" ? !!name.trim() && !!whatsapp && (!needsBudget || (budget !== "" && budget > 0)) : !!sourceAdSetId);

  return (
    <div className="space-y-5">
      <ClientStep clients={clients} clientId={clientId} onClientChange={(id) => { onClientChange(id); setCampaignId(""); setSourceAdSetId(""); setTargetCampaignId(""); }} />

      <Step n={2} title="Como você quer criar o conjunto?" disabled={!client}>
        <HowToggle value={how} onChange={setHow} labels={["Criar do zero", "Duplicar um conjunto"]} />
      </Step>

      <Step
        n={3}
        title={how === "novo" ? "Em qual campanha?" : "De qual campanha é o conjunto original?"}
        hint="O conjunto precisa ficar dentro de uma campanha."
        disabled={!client}
      >
        <OptionSelect
          options={campaigns.data}
          loading={campaigns.isLoading}
          value={campaignId}
          onChange={(v) => { setCampaignId(v); setSourceAdSetId(""); setTargetCampaignId(""); }}
          placeholder="Selecione a campanha"
          emptyText="Esse cliente não tem campanhas ativas ou pausadas."
        />
      </Step>

      {how === "duplicar" && (
        <Step n={4} title="Qual conjunto duplicar?" disabled={!campaignId}>
          <OptionSelect
            options={adSets.data}
            loading={adSets.isLoading}
            value={sourceAdSetId}
            onChange={setSourceAdSetId}
            placeholder="Selecione o conjunto"
            emptyText="Essa campanha não tem conjuntos."
          />
          <div className="space-y-1.5 pt-1">
            <Label>Duplicar para qual campanha?</Label>
            <OptionSelect
              options={campaigns.data}
              loading={campaigns.isLoading}
              value={targetCampaignId || campaignId}
              onChange={setTargetCampaignId}
              placeholder="Selecione a campanha de destino"
              emptyText="Sem campanhas."
            />
            <p className="text-xs text-muted-foreground">Por padrão a cópia fica na mesma campanha.</p>
          </div>
        </Step>
      )}

      <Step n={how === "duplicar" ? 5 : 4} title="Dados do novo conjunto" disabled={!campaignId || (how === "duplicar" && !sourceAdSetId)}>
        <div className="space-y-1.5">
          <Label>Nome do conjunto{how === "duplicar" && " (opcional)"}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={how === "novo" ? "Ex: CA2 - ABERTO" : "Em branco = nome original + “- Cópia”"} />
        </div>
        {how === "novo" && (
          <>
            <div className="space-y-1.5">
              <Label>Número do WhatsApp que recebe as conversas</Label>
              <WhatsappNumberPicker
                accountId={client?.meta_ad_account_id}
                pageId={client?.meta_page_id ?? undefined}
                value={whatsapp}
                onChange={setWhatsapp}
              />
              <p className="text-xs text-muted-foreground">Escolha agora: depois de criado, a Meta não deixa trocar o número.</p>
            </div>
            {needsBudget && (
              <div className="space-y-1.5">
                <Label>Orçamento diário (R$)</Label>
                <Input type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value === "" ? "" : Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">Essa campanha não tem orçamento próprio, então o conjunto precisa de um.</p>
              </div>
            )}
          </>
        )}
      </Step>

      <div className="flex justify-end">
        <Button disabled={!valid || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Criando..." : how === "novo" ? "Criar conjunto" : "Duplicar conjunto"}
        </Button>
      </div>
    </div>
  );
}

// ── Anúncio ──────────────────────────────────────────────────────────────────

export function AdCreator({ clients, clientId, onClientChange }: CreatorProps) {
  const client = clients.find((c) => c.id === clientId);
  const [how, setHow] = useState<"novo" | "duplicar">("novo");
  const [campaignId, setCampaignId] = useState("");
  const [adSetId, setAdSetId] = useState("");
  const [sourceAdId, setSourceAdId] = useState("");
  const [targetAdSetId, setTargetAdSetId] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [greeting, setGreeting] = useState("");
  const [preMessage, setPreMessage] = useState("");
  const [done, setDone] = useState<{ campaignId: string; text: string } | null>(null);

  const { campaigns, adSets, ads } = useStructure(client, campaignId, adSetId, how === "duplicar");
  const destAdSetId = how === "duplicar" ? targetAdSetId || adSetId : adSetId;

  const reset = () => {
    setDone(null);
    setName("");
    setFile(null);
    setSourceAdId("");
  };

  const run = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Selecione um cliente.");
      const token = await getMetaToken(client.id);
      if (!token) throw new Error("Token Meta não encontrado. Acesse Configurações.");
      const pid = "structure-progress";
      const progress = (m: string) => toast.loading(m, { id: pid });
      try {
        if (how === "duplicar") {
          const writer = await getN8nMetaWriter(token, "duplicar-anuncio", progress);
          await duplicateAd(sourceAdId, destAdSetId, client.meta_ad_account_id, token, writer, name);
          return;
        }
        if (!file) throw new Error("Selecione uma imagem ou vídeo.");
        const pageId = client.meta_page_id ?? "";
        if (!pageId) throw new Error("O cliente não tem Página do Facebook cadastrada.");
        // O número do anúncio tem que ser o do conjunto onde ele vai entrar.
        const number = ((await fetchAdSetWhatsappNumber(adSetId, token)) ?? client.meta_whatsapp_number ?? "").replace(/\D/g, "");
        if (!number) throw new Error("Não achei o número de WhatsApp desse conjunto. Cadastre o número no cliente.");

        const isVideo = file.type.startsWith("video/");
        let imageHash: string | undefined;
        let videoId: string | undefined;
        let thumbnailUrl: string | undefined;
        if (isVideo) {
          progress("Enviando vídeo...");
          videoId = await uploadAdVideo(client.meta_ad_account_id, file, token, progress);
          thumbnailUrl = (await waitForVideoReady(videoId, token, progress)) ?? undefined;
        } else {
          progress("Enviando imagem...");
          imageHash = await uploadAdImage(client.meta_ad_account_id, file, token);
        }
        const writer = await getN8nMetaWriter(token, "criar-anuncio", progress);
        await createAdInAdSet(
          client.meta_ad_account_id,
          { name: name.trim(), adSetId },
          {
            name: name.trim(),
            pageId,
            whatsappNumber: number,
            whatsappMessage: preMessage || undefined,
            whatsappGreeting: greeting || undefined,
            primaryText,
            headline,
            description: description || undefined,
            mediaType: isVideo ? "video" : "image",
            imageHash,
            videoId,
            thumbnailUrl,
            instagramUserId: await fetchPageInstagramUserId(pageId, token),
          },
          token,
          writer
        );
      } finally {
        toast.dismiss(pid);
      }
    },
    onSuccess: () =>
      setDone({
        campaignId,
        text:
          how === "novo"
            ? "O anúncio foi criado pausado dentro do conjunto escolhido. Revise no editor da campanha e ative quando estiver pronto."
            : "O anúncio foi duplicado pausado. Revise no editor da campanha e ative quando estiver pronto.",
      }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar o anúncio.", { duration: 12000 }),
  });

  if (done) return <DoneCard title={how === "novo" ? "Anúncio criado!" : "Anúncio duplicado!"} text={done.text} clientId={clientId} campaignId={done.campaignId} onAgain={reset} />;

  const valid =
    !!client && !!campaignId && !!adSetId && (how === "novo" ? !!name.trim() && !!file && !!primaryText.trim() && !!headline.trim() : !!sourceAdId);

  return (
    <div className="space-y-5">
      <ClientStep
        clients={clients}
        clientId={clientId}
        onClientChange={(id) => { onClientChange(id); setCampaignId(""); setAdSetId(""); setSourceAdId(""); setTargetAdSetId(""); }}
      />

      <Step n={2} title="Como você quer criar o anúncio?" disabled={!client}>
        <HowToggle value={how} onChange={setHow} labels={["Criar do zero", "Duplicar um anúncio"]} />
      </Step>

      <Step n={3} title="Em qual campanha?" disabled={!client}>
        <OptionSelect
          options={campaigns.data}
          loading={campaigns.isLoading}
          value={campaignId}
          onChange={(v) => { setCampaignId(v); setAdSetId(""); setSourceAdId(""); setTargetAdSetId(""); }}
          placeholder="Selecione a campanha"
          emptyText="Esse cliente não tem campanhas ativas ou pausadas."
        />
      </Step>

      <Step n={4} title={how === "novo" ? "Em qual conjunto?" : "De qual conjunto é o anúncio original?"} hint="O anúncio precisa ficar dentro de um conjunto." disabled={!campaignId}>
        <OptionSelect
          options={adSets.data}
          loading={adSets.isLoading}
          value={adSetId}
          onChange={(v) => { setAdSetId(v); setSourceAdId(""); setTargetAdSetId(""); }}
          placeholder="Selecione o conjunto"
          emptyText="Essa campanha não tem conjuntos. Crie um conjunto primeiro."
        />
      </Step>

      {how === "duplicar" && (
        <Step n={5} title="Qual anúncio duplicar?" disabled={!adSetId}>
          <OptionSelect
            options={ads.data}
            loading={ads.isLoading}
            value={sourceAdId}
            onChange={setSourceAdId}
            placeholder="Selecione o anúncio"
            emptyText="Esse conjunto não tem anúncios."
          />
          <div className="space-y-1.5 pt-1">
            <Label>Duplicar para qual conjunto?</Label>
            <OptionSelect
              options={adSets.data}
              loading={adSets.isLoading}
              value={targetAdSetId || adSetId}
              onChange={setTargetAdSetId}
              placeholder="Selecione o conjunto de destino"
              emptyText="Sem conjuntos."
            />
            <p className="text-xs text-muted-foreground">Por padrão a cópia fica no mesmo conjunto (da mesma campanha).</p>
          </div>
        </Step>
      )}

      <Step n={how === "duplicar" ? 6 : 5} title="Dados do novo anúncio" disabled={!adSetId || (how === "duplicar" && !sourceAdId)}>
        <div className="space-y-1.5">
          <Label>Nome do anúncio{how === "duplicar" && " (opcional)"}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={how === "novo" ? "Ex: AD2 - ARTE" : "Em branco = nome original + “- Cópia”"} />
        </div>
        {how === "novo" && (
          <>
            <div className="space-y-1.5">
              <Label>Imagem ou vídeo</Label>
              <label className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:bg-muted/40">
                <ImagePlus className="h-4 w-4" />
                <span className="truncate">{file ? file.name : "Escolher arquivo"}</span>
                <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>Texto principal</Label>
              <Textarea value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Mensagem de saudação (opcional)</Label>
                <Textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Mensagem pré-pronta (opcional)</Label>
                <Textarea value={preMessage} onChange={(e) => setPreMessage(e.target.value)} rows={2} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">O número de WhatsApp e a Página são os do conjunto escolhido.</p>
          </>
        )}
      </Step>

      <div className="flex justify-end">
        <Button disabled={!valid || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Criando..." : how === "novo" ? "Criar anúncio" : "Duplicar anúncio"}
        </Button>
      </div>
    </div>
  );
}
