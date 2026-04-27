import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pause,
  Play,
  Pencil,
  Check,
  X,
  Image,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchAdSets,
  fetchAds,
  getMetaToken,
  updateMetaObject,
  type MetaCampaign,
  type MetaAdSet,
  type MetaAd,
} from "@/lib/meta";
import { brl } from "@/lib/mock-data";

interface CampaignSheetProps {
  campaign: MetaCampaign | null;
  clientId: string;
  adAccountId: string;
  cplMax: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CampaignSheet({
  campaign,
  clientId,
  adAccountId,
  cplMax,
  open,
  onOpenChange,
}: CampaignSheetProps) {
  const queryClient = useQueryClient();

  const invalidateCampaigns = () => {
    queryClient.invalidateQueries({ queryKey: ["campaigns", clientId] });
  };

  if (!campaign) return null;

  const metaUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace("act_", "")}&selected_campaign_ids=${campaign.id}`;
  const isActive = campaign.status === "ACTIVE";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0 overflow-y-auto">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              <SheetTitle className="text-base leading-snug line-clamp-2 text-left">
                {campaign.name}
              </SheetTitle>
              <p className="text-xs text-muted-foreground mt-1">{campaign.id}</p>
            </div>
            <a
              href={metaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 mt-0.5"
            >
              <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs">
                <ExternalLink className="h-3 w-3" />
                Meta
              </Button>
            </a>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Campaign level */}
          <CampaignSection
            campaign={campaign}
            cplMax={cplMax}
            onStatusChange={invalidateCampaigns}
            onNameChange={invalidateCampaigns}
          />

          <Separator />

          {/* Ad Sets level */}
          <AdSetsSection
            campaignId={campaign.id}
            clientId={clientId}
            isActive={isActive}
            onStatusChange={invalidateCampaigns}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Campaign section ───────────────────────────────────────────

function CampaignSection({
  campaign,
  cplMax,
  onStatusChange,
  onNameChange,
}: {
  campaign: MetaCampaign;
  cplMax: number;
  onStatusChange: () => void;
  onNameChange: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(campaign.name);

  const isActive = campaign.status === "ACTIVE";

  const statusMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(campaign.id, { status: isActive ? "PAUSED" : "ACTIVE" }, token);
    },
    onSuccess: () => {
      toast.success(isActive ? "Campanha pausada." : "Campanha ativada.");
      onStatusChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar"),
  });

  const nameMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(campaign.id, { name: nameInput.trim() }, token);
    },
    onSuccess: () => {
      toast.success("Nome atualizado.");
      setEditingName(false);
      onNameChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const cplColor =
    campaign.cpl === null
      ? "text-foreground"
      : campaign.cpl <= cplMax
      ? "text-green-500"
      : campaign.cpl <= cplMax * 1.3
      ? "text-yellow-500"
      : "text-red-500";

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>Campanha</SectionLabel>
        <div className="flex items-center gap-2">
          <Badge variant={isActive ? "default" : "secondary"} className="text-xs">
            {isActive ? "Ativa" : "Pausada"}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => statusMutation.mutate()}
                disabled={statusMutation.isPending}
              >
                {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isActive ? "Pausar" : "Ativar"} campanha</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Editable name */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Nome</p>
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") nameMutation.mutate();
                if (e.key === "Escape") { setEditingName(false); setNameInput(campaign.name); }
              }}
            />
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => nameMutation.mutate()} disabled={nameMutation.isPending}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { setEditingName(false); setNameInput(campaign.name); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <p className="text-sm font-medium leading-snug flex-1">{campaign.name}</p>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setEditingName(true)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCell label="Objetivo" value={campaign.objective} small />
        <MetricCell label="Orçamento/dia" value={campaign.daily_budget !== null ? brl(campaign.daily_budget) : "—"} />
        <MetricCell label="Gasto" value={campaign.spend > 0 ? brl(campaign.spend) : "—"} />
        <MetricCell label="Leads" value={campaign.leads > 0 ? String(campaign.leads) : "—"} />
        <MetricCell label="CPL" value={campaign.cpl !== null ? brl(campaign.cpl) : "—"} valueClass={cplColor} />
        <MetricCell label="Impressões" value={campaign.impressions > 0 ? campaign.impressions.toLocaleString("pt-BR") : "—"} />
      </div>
    </div>
  );
}

// ── Ad Sets section ────────────────────────────────────────────

function AdSetsSection({
  campaignId,
  clientId,
  isActive,
  onStatusChange,
}: {
  campaignId: string;
  clientId: string;
  isActive: boolean;
  onStatusChange: () => void;
}) {
  const { data: adSets, isLoading } = useQuery({
    queryKey: ["adsets", campaignId],
    queryFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      return fetchAdSets(campaignId, token);
    },
  });

  return (
    <div className="px-5 py-4 space-y-3">
      <SectionLabel>Conjuntos de Anúncios</SectionLabel>
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : !adSets || adSets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum conjunto encontrado.</p>
      ) : (
        <div className="space-y-2">
          {adSets.map((adSet) => (
            <AdSetRow
              key={adSet.id}
              adSet={adSet}
              clientId={clientId}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdSetRow({
  adSet,
  clientId,
  onStatusChange,
}: {
  adSet: MetaAdSet;
  clientId: string;
  onStatusChange: () => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(adSet.name);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(adSet.daily_budget ?? 0);

  const isActive = adSet.status === "ACTIVE";

  const { data: ads, isLoading: adsLoading } = useQuery({
    queryKey: ["ads", adSet.id],
    queryFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      return fetchAds(adSet.id, token);
    },
    enabled: expanded,
  });

  const statusMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(adSet.id, { status: isActive ? "PAUSED" : "ACTIVE" }, token);
    },
    onSuccess: () => {
      toast.success(isActive ? "Conjunto pausado." : "Conjunto ativado.");
      queryClient.invalidateQueries({ queryKey: ["adsets"] });
      onStatusChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar"),
  });

  const nameMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(adSet.id, { name: nameInput.trim() }, token);
    },
    onSuccess: () => {
      toast.success("Nome atualizado.");
      setEditingName(false);
      queryClient.invalidateQueries({ queryKey: ["adsets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const budgetMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(adSet.id, { daily_budget: String(Math.round(budgetInput * 100)) }, token);
    },
    onSuccess: () => {
      toast.success("Orçamento atualizado.");
      setEditingBudget(false);
      queryClient.invalidateQueries({ queryKey: ["adsets"] });
      onStatusChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  return (
    <div className={`rounded-lg border border-border bg-card transition-opacity ${isActive ? "" : "opacity-60"}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="h-7 text-xs flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") nameMutation.mutate();
                  if (e.key === "Escape") { setEditingName(false); setNameInput(adSet.name); }
                }}
              />
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => nameMutation.mutate()} disabled={nameMutation.isPending}>
                <Check className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { setEditingName(false); setNameInput(adSet.name); }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group">
              <p className="text-sm font-medium truncate">{adSet.name}</p>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
              >
                <Pencil className="h-2.5 w-2.5" />
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground">
              {adSet.optimization_goal || "—"}
            </span>
            {editingBudget ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">R$</span>
                <Input
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(Number(e.target.value))}
                  className="h-5 w-16 text-xs px-1"
                  min={1}
                  step={1}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") budgetMutation.mutate();
                    if (e.key === "Escape") { setEditingBudget(false); setBudgetInput(adSet.daily_budget ?? 0); }
                  }}
                />
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => budgetMutation.mutate()} disabled={budgetMutation.isPending}>
                  <Check className="h-2.5 w-2.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setEditingBudget(false); setBudgetInput(adSet.daily_budget ?? 0); }}>
                  <X className="h-2.5 w-2.5" />
                </Button>
              </div>
            ) : adSet.daily_budget !== null ? (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                onClick={() => setEditingBudget(true)}
              >
                · {brl(adSet.daily_budget)}/dia
                <Pencil className="h-2.5 w-2.5 ml-0.5 opacity-0 group-hover:opacity-100" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant={isActive ? "default" : "secondary"} className="text-[10px] h-5 px-1.5">
            {isActive ? "Ativo" : "Pausado"}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => statusMutation.mutate()}
                disabled={statusMutation.isPending}
              >
                {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isActive ? "Pausar" : "Ativar"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Ads list */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5 bg-muted/20">
          {adsLoading ? (
            <div className="space-y-1.5">
              {[1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded-md" />)}
            </div>
          ) : !ads || ads.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">Nenhum anúncio encontrado.</p>
          ) : (
            ads.map((ad) => (
              <AdRow key={ad.id} ad={ad} adSetId={adSet.id} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AdRow({ ad, adSetId }: { ad: MetaAd; adSetId: string }) {
  const queryClient = useQueryClient();
  const isActive = ad.status === "ACTIVE";

  const statusMutation = useMutation({
    mutationFn: async () => {
      const token = await getMetaToken();
      if (!token) throw new Error("Token não encontrado");
      await updateMetaObject(ad.id, { status: isActive ? "PAUSED" : "ACTIVE" }, token);
    },
    onSuccess: () => {
      toast.success(isActive ? "Anúncio pausado." : "Anúncio ativado.");
      queryClient.invalidateQueries({ queryKey: ["ads", adSetId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar"),
  });

  return (
    <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive ? "" : "opacity-60"}`}>
      {ad.thumbnail_url ? (
        <img
          src={ad.thumbnail_url}
          alt=""
          className="h-8 w-8 rounded object-cover shrink-0 border border-border"
        />
      ) : (
        <div className="h-8 w-8 rounded border border-border bg-muted flex items-center justify-center shrink-0">
          <Image className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
      <p className="text-xs flex-1 truncate font-medium">{ad.name}</p>
      <Badge variant={isActive ? "default" : "secondary"} className="text-[10px] h-5 px-1.5 shrink-0">
        {isActive ? "Ativo" : "Pausado"}
      </Badge>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={() => statusMutation.mutate()}
            disabled={statusMutation.isPending}
          >
            {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isActive ? "Pausar" : "Ativar"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function MetricCell({
  label,
  value,
  valueClass = "",
  small = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  small?: boolean;
}) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-semibold tabular-nums truncate ${small ? "text-xs" : "text-sm"} ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}
