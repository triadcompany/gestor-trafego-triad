import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ShieldAlert,
  Copy,
  Check,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Stethoscope,
  Bot,
  Webhook,
  Send,
  Plus,
  Trash2,
  Users as UsersIcon,
  MessageCircle,
  Star,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getOpenAIKey,
  saveOpenAIKey,
  getSendDestinations,
  saveSendDestinations,
  fetchMetaTokens,
  upsertMetaToken,
  deleteMetaToken,
  type SendDestination,
} from "@/lib/meta";
import {
  fetchWhatsappInstances,
  createWhatsappInstance,
  renameWhatsappInstance,
  deleteWhatsappInstance,
  fetchWhatsappInstanceQr,
  fetchWhatsappInstanceState,
} from "@/lib/whatsapp-messages";
import { getN8nWebhookUrl, saveN8nWebhookUrl } from "@/lib/n8n";
import {
  agentListConversations,
  agentSetConversationPinned,
  agentGetAssistants,
  agentSaveAssistantPrompt,
  type AssistantConfig,
} from "@/lib/agent-chat";
import { fetchOrgMembers, createOrgMember, updateOrgMemberRole, setOrgMemberActive } from "@/server/team";
import { getCurrentUser } from "@/server/session";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Configurações — Gestor de Tráfego" }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: currentUser } = useQuery({ queryKey: ["current-user"], queryFn: getCurrentUser, staleTime: 1000 * 60 });
  const isAdmin = currentUser?.role === "admin";

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {currentUser?.organizationName ? `Organização: ${currentUser.organizationName}` : "Integrações e preferências do sistema."}
          </p>
        </div>

        <Tabs defaultValue="meta" orientation="vertical" className="flex flex-col md:flex-row gap-6 md:gap-8">
          <TabsList className="flex md:flex-col h-auto w-full md:w-52 shrink-0 bg-transparent p-0 gap-1 overflow-x-auto md:overflow-visible justify-start">
            <TabsTrigger value="meta" className="justify-start w-full data-[state=active]:bg-muted data-[state=active]:shadow-none">Token Meta Ads</TabsTrigger>
            <TabsTrigger value="whatsapp" className="justify-start w-full data-[state=active]:bg-muted data-[state=active]:shadow-none">Conectar WhatsApp</TabsTrigger>
            {isAdmin && <TabsTrigger value="users" className="justify-start w-full data-[state=active]:bg-muted data-[state=active]:shadow-none">Usuários</TabsTrigger>}
            <TabsTrigger value="agent" className="justify-start w-full data-[state=active]:bg-muted data-[state=active]:shadow-none">Agente de IA</TabsTrigger>
            <TabsTrigger value="webhook" className="justify-start w-full data-[state=active]:bg-muted data-[state=active]:shadow-none">Webhook</TabsTrigger>
            <TabsTrigger value="diagnostico" className="justify-start w-full data-[state=active]:bg-muted data-[state=active]:shadow-none">Diagnóstico</TabsTrigger>
            <TabsTrigger value="sistema" className="justify-start w-full data-[state=active]:bg-muted data-[state=active]:shadow-none">Sistema</TabsTrigger>
          </TabsList>

          <div className="flex-1 min-w-0">
          <TabsContent value="meta" className="mt-0">
            <MetaTokensSection isAdmin={isAdmin} />
          </TabsContent>

          <TabsContent value="whatsapp" className="mt-0">
            <WhatsappInstancesSection />
            <SendDestinationsSection />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="users" className="mt-0">
              <UsersSection />
            </TabsContent>
          )}

          <TabsContent value="agent" className="mt-0">
            <OpenAISection />
            <AgentPinnedSection />
          </TabsContent>

          <TabsContent value="webhook" className="mt-0">
            <N8nSection />
          </TabsContent>

          <TabsContent value="diagnostico" className="mt-0">
            <section className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Diagnóstico Meta</h2>
              </div>
              <Card className="p-5 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Checagem de permissões do token, validade, conta conectada e teste de leitura de saldo por cliente.
                </p>
                <Button asChild>
                  <Link to="/diagnostico-meta" className="gap-2">
                    <Stethoscope className="h-4 w-4" />
                    Abrir diagnóstico
                  </Link>
                </Button>
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="sistema" className="mt-0">
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-1 w-1 rounded-full bg-muted-foreground" />
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Sistema</h2>
              </div>
              <Card className="divide-y divide-border">
                {[
                  { label: "Versão", value: "0.2.0" },
                  { label: "API Meta", value: "Graph API v21.0" },
                  { label: "Sync automático", value: "A cada hora" },
                  { label: "Dados armazenados", value: "PostgreSQL (VPS própria)" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))}
              </Card>
            </section>
          </TabsContent>
          </div>
        </Tabs>
      </div>
    </AppShell>
  );
}

// ── Tokens Meta ──────────────────────────────────────────────────────────────

function MetaTokensSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [assignedUserId, setAssignedUserId] = useState<string>("none");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: tokens = [], isLoading } = useQuery({ queryKey: ["meta-tokens"], queryFn: fetchMetaTokens });
  const { data: members = [] } = useQuery({ queryKey: ["org-members"], queryFn: fetchOrgMembers, enabled: isAdmin });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token.trim()}`);
      const json = (await res.json()) as { name?: string; error?: { message: string } };
      if (json.error || !json.name) throw new Error(json.error?.message ?? "Token inválido");
      const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000);
      await upsertMetaToken({
        label: label.trim() || "Principal",
        accessToken: token.trim(),
        expiresAt: expiresAt.toISOString(),
        assignedUserId: assignedUserId === "none" ? null : assignedUserId,
      });
      return json.name;
    },
    onSuccess: (name) => {
      toast.success(`Token salvo! Conectado como ${name}.`);
      setOpen(false);
      setLabel("");
      setToken("");
      setAssignedUserId("none");
      queryClient.invalidateQueries({ queryKey: ["meta-tokens"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar token"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMetaToken,
    onSuccess: () => {
      toast.success("Token removido.");
      queryClient.invalidateQueries({ queryKey: ["meta-tokens"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao remover token"),
  });

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Tokens Meta Ads</h2>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Novo token
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo token Meta</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>Nome (ex: "Token do João")</Label>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Principal" />
                </div>
                <div className="space-y-1.5">
                  <Label>Token de acesso</Label>
                  <Textarea
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="EAASR9JZBuCzIBO..."
                    className="font-mono text-xs resize-none h-20"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Atribuir a um gestor (opcional)</Label>
                  <Select value={assignedUserId} onValueChange={setAssignedUserId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ninguém em específico</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => saveMutation.mutate()} disabled={!token.trim() || saveMutation.isPending}>
                  {saveMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Validar e salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="divide-y divide-border">
        {isLoading ? (
          <div className="px-5 py-4 text-sm text-muted-foreground">Carregando...</div>
        ) : tokens.length === 0 ? (
          <div className="px-5 py-4 flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-muted-foreground">
              Nenhum token configurado. {isAdmin ? "Adicione um acima para sincronizar campanhas." : "Peça a um admin da organização para configurar."}
            </p>
          </div>
        ) : (
          tokens.map((t) => {
            const daysLeft = t.expiresAt ? Math.floor((new Date(t.expiresAt).getTime() - Date.now()) / 86400000) : null;
            const assigned = members.find((m) => m.id === t.assignedUserId);
            return (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {daysLeft !== null ? (daysLeft <= 0 ? "Expirado" : `Expira em ${daysLeft} dias`) : "Sem validade definida"}
                    {assigned ? ` · ${assigned.fullName}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className={t.active ? "border-status-on-target/40 text-status-on-target" : "border-muted-foreground/30 text-muted-foreground"}>
                  {t.active ? "Ativo" : "Inativo"}
                </Badge>
                {isAdmin && (
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(t.id)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </Card>

      <details className="mt-3 rounded-lg border border-border bg-muted/20 group">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-medium select-none">
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Como pegar o token da Meta
          </span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0" />
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-4 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-1.5">Jeito rápido — token de 60 dias</p>
            <ol className="list-decimal ml-5 space-y-1.5">
              <li>
                Abra o{" "}
                <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer"
                   className="text-primary underline underline-offset-2 inline-flex items-center gap-1">
                  Graph API Explorer <ExternalLink className="h-3 w-3" />
                </a>{" "}
                e selecione o app da Business Manager no seletor de cima.
              </li>
              <li>Em <strong className="text-foreground">Permissions</strong>, adicione <code className="bg-muted px-1 rounded text-[11px]">ads_read</code> e <code className="bg-muted px-1 rounded text-[11px]">ads_management</code>.</li>
              <li>Clique em <strong className="text-foreground">Generate Access Token</strong> e autorize.</li>
              <li>Copie o token e cole aqui em <strong className="text-foreground">Novo token</strong> — o sistema valida e guarda com validade de 60 dias.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1.5">Jeito recomendado — System User (não expira toda hora)</p>
            <ol className="list-decimal ml-5 space-y-1.5">
              <li>
                <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer"
                   className="text-primary underline underline-offset-2 inline-flex items-center gap-1">
                  Configurações do Negócio → Usuários → Usuários do sistema <ExternalLink className="h-3 w-3" />
                </a>{" "}
                → <strong className="text-foreground">Adicionar</strong>, função <strong className="text-foreground">Admin</strong>.
              </li>
              <li>No usuário criado: <strong className="text-foreground">Atribuir ativos</strong> → contas de anúncio dos clientes → acesso total.</li>
              <li><strong className="text-foreground">Gerar novo token</strong> → escolha o app da BM → marque <code className="bg-muted px-1 rounded text-[11px]">ads_read</code> e <code className="bg-muted px-1 rounded text-[11px]">ads_management</code> → gerar.</li>
              <li>Copie o token e cole aqui em <strong className="text-foreground">Novo token</strong>.</li>
            </ol>
          </div>
          <p className="text-[11px]">
            Dica: crie um token por gestor (campo "Atribuir a um gestor") e, no cadastro de cada cliente, escolha qual token aquele cliente usa.
          </p>
        </div>
      </details>
    </section>
  );
}

// ── Instâncias WhatsApp ────────────────────────────────────────────────────

function WaStateDot({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["wa-state", id],
    queryFn: () => fetchWhatsappInstanceState(id),
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const s = data?.state;
  const map: Record<string, { c: string; t: string }> = {
    open: { c: "bg-status-on-target", t: "Conectado" },
    connecting: { c: "bg-status-attention", t: "Conectando" },
    close: { c: "bg-muted-foreground/40", t: "Desconectado" },
    unknown: { c: "bg-muted-foreground/40", t: "—" },
  };
  const v = map[s ?? "unknown"] ?? map.unknown;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${v.c}`} />
      {v.t}
    </span>
  );
}

function QrDialog({
  instanceId,
  initialQr,
  onClose,
  onConnected,
}: {
  instanceId: string | null;
  initialQr: string | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [qr, setQr] = useState<string | null>(initialQr);
  const [refreshing, setRefreshing] = useState(false);

  const { data: state } = useQuery({
    queryKey: ["wa-state-poll", instanceId],
    queryFn: () => fetchWhatsappInstanceState(instanceId!),
    enabled: !!instanceId,
    refetchInterval: 3000,
  });
  const connected = state?.state === "open";

  useEffect(() => {
    setQr(initialQr);
  }, [initialQr, instanceId]);

  useEffect(() => {
    if (connected) {
      const t = setTimeout(onConnected, 1200);
      return () => clearTimeout(t);
    }
  }, [connected, onConnected]);

  // QR da Evolution expira rápido — busca de novo a cada 30s enquanto não conectar.
  useEffect(() => {
    if (!instanceId || connected) return;
    const t = setInterval(async () => {
      try {
        const r = await fetchWhatsappInstanceQr(instanceId);
        if (r.qrBase64) setQr(r.qrBase64);
      } catch { /* ignora */ }
    }, 30000);
    return () => clearInterval(t);
  }, [instanceId, connected]);

  const manualRefresh = async () => {
    if (!instanceId) return;
    setRefreshing(true);
    try {
      const r = await fetchWhatsappInstanceQr(instanceId);
      setQr(r.qrBase64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar QR");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Dialog open={!!instanceId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {connected ? (
            <div className="py-8 text-center">
              <Check className="h-10 w-10 mx-auto text-status-on-target mb-2" />
              <p className="text-sm font-medium text-status-on-target">Conectado!</p>
            </div>
          ) : qr ? (
            <>
              <img src={qr} alt="QR code" className="w-56 h-56 rounded-lg border border-border bg-white" />
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                No celular: WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong> e escaneie.
              </p>
              <Button variant="outline" size="sm" onClick={manualRefresh} disabled={refreshing} className="gap-2">
                {refreshing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Atualizar QR
              </Button>
            </>
          ) : (
            <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <p className="text-xs">Gerando QR...</p>
              <Button variant="outline" size="sm" onClick={manualRefresh} disabled={refreshing}>Tentar de novo</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WhatsappInstancesSection() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [assignedUserId, setAssignedUserId] = useState<string>("none");
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qrInitial, setQrInitial] = useState<string | null>(null);

  const { data: instances = [], isLoading } = useQuery({ queryKey: ["whatsapp-instances"], queryFn: fetchWhatsappInstances });
  const { data: members = [] } = useQuery({ queryKey: ["org-members"], queryFn: fetchOrgMembers });

  const createMutation = useMutation({
    mutationFn: () =>
      createWhatsappInstance({
        label: label.trim() || instanceName.trim(),
        instanceName: instanceName.trim(),
        assignedUserId: assignedUserId === "none" ? null : assignedUserId,
      }),
    onSuccess: (res) => {
      setOpen(false);
      setLabel("");
      setInstanceName("");
      setAssignedUserId("none");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
      setQrInitial(res.qrBase64);
      setQrFor(res.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar instância", { duration: 8000 }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWhatsappInstance,
    onSuccess: () => {
      toast.success("Instância removida.");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao remover instância"),
  });

  const openConnect = async (id: string) => {
    setQrInitial(null);
    setQrFor(id);
    try {
      const r = await fetchWhatsappInstanceQr(id);
      setQrInitial(r.qrBase64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar QR");
    }
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Instâncias WhatsApp</h2>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Nova instância
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova instância de WhatsApp</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    if (!instanceName || instanceName === slugify(label)) setInstanceName(slugify(e.target.value));
                  }}
                  placeholder='Ex: "WhatsApp do João"'
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nome da instância (técnico)</Label>
                <Input
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="whatsapp-joao"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">Só letras, números e hífen. Um sufixo curto da organização é adicionado automaticamente.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Atribuir a um gestor (opcional)</Label>
                <Select value={assignedUserId} onValueChange={setAssignedUserId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguém em específico</SelectItem>
                    {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMutation.mutate()} disabled={!instanceName.trim() || createMutation.isPending}>
                {createMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
                Criar e mostrar QR
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="divide-y divide-border">
        {isLoading ? (
          <div className="px-5 py-4 text-sm text-muted-foreground">Carregando...</div>
        ) : instances.length === 0 ? (
          <div className="px-5 py-4 text-sm text-muted-foreground">
            Nenhuma instância. Clique em "Nova instância" pra gerar uma e conectar pelo QR code.
          </div>
        ) : (
          instances.map((i) => {
            const assigned = members.find((m) => m.id === i.assignedUserId);
            return (
              <div key={i.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{i.label}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {i.instanceName}{assigned ? ` · ${assigned.fullName}` : ""}
                  </p>
                </div>
                <WaStateDot id={i.id} />
                <Button size="sm" variant="outline" onClick={() => openConnect(i.id)}>Conectar</Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir a instância "${i.label}"? Isso desconecta e apaga ela na Evolution.`)) deleteMutation.mutate(i.id); }} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })
        )}
      </Card>

      <QrDialog
        instanceId={qrFor}
        initialQr={qrInitial}
        onClose={() => { setQrFor(null); setQrInitial(null); }}
        onConnected={() => {
          setQrFor(null);
          setQrInitial(null);
          queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
          queryClient.invalidateQueries({ queryKey: ["wa-state"] });
          toast.success("WhatsApp conectado!");
        }}
      />
    </section>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// ── Usuários ─────────────────────────────────────────────────────────────────

function UsersSection() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { data: members = [], isLoading } = useQuery({ queryKey: ["org-members"], queryFn: fetchOrgMembers });

  const createMutation = useMutation({
    mutationFn: () => createOrgMember({ fullName: fullName.trim(), email: email.trim(), password, role: "member" }),
    onSuccess: () => {
      toast.success("Usuário criado! Compartilhe a senha com ele por fora do sistema.");
      setOpen(false);
      setFullName("");
      setEmail("");
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar usuário"),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "member" }) => updateOrgMemberRole(userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-members"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao alterar papel"),
  });

  const activeMutation = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) => setOrgMemberActive(userId, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-members"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao alterar acesso"),
  });

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Usuários</h2>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Novo usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo usuário da organização</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Senha inicial</Label>
                <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 8 caracteres" />
                <p className="text-[11px] text-muted-foreground">Compartilhe essa senha com a pessoa por fora do sistema — ela pode trocar depois.</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!fullName.trim() || !email.trim() || password.length < 8 || createMutation.isPending}
              >
                {createMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
                Criar usuário
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="divide-y divide-border">
        {isLoading ? (
          <div className="px-5 py-4 text-sm text-muted-foreground">Carregando...</div>
        ) : (
          members.map((m) => (
            <div key={m.id} className="px-5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${!m.active ? "text-muted-foreground line-through" : ""}`}>{m.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>
              <Select value={m.role} onValueChange={(v) => roleMutation.mutate({ userId: m.id, role: v as "admin" | "member" })}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Membro</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => activeMutation.mutate({ userId: m.id, active: !m.active })}
              >
                {m.active ? "Desativar" : "Ativar"}
              </Button>
            </div>
          ))
        )}
      </Card>
    </section>
  );
}

// ── OpenAI, n8n e destino dos envios (sem mudanças de fundo) ─────────────────

function OpenAISection() {
  const queryClient = useQueryClient();
  const [newOpenAIKey, setNewOpenAIKey] = useState("");

  const { data: openAIKey, isLoading: isLoadingOpenAI } = useQuery({
    queryKey: ["openai-key"],
    queryFn: getOpenAIKey,
    staleTime: 1000 * 60 * 5,
  });

  const saveOpenAIMutation = useMutation({
    mutationFn: saveOpenAIKey,
    onSuccess: () => {
      toast.success("Chave do agente salva com sucesso!");
      setNewOpenAIKey("");
      queryClient.invalidateQueries({ queryKey: ["openai-key"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar chave"),
  });

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">API Key do Agente (OpenAI)</h2>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-4 border-b border-border bg-muted/10">
          <KeyRound className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            {isLoadingOpenAI ? (
              <p className="text-sm text-muted-foreground">Verificando...</p>
            ) : openAIKey ? (
              <>
                <p className="text-sm font-medium text-status-on-target">Chave configurada</p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {openAIKey.slice(0, 6)}...{openAIKey.slice(-4)}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-destructive">Sem chave configurada</p>
                <p className="text-xs text-muted-foreground mt-0.5">O agente de IA não poderá funcionar.</p>
              </>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="openai-input">{!openAIKey ? "Cole a nova chave API" : "Atualizar chave API"}</Label>
            <Textarea
              id="openai-input"
              value={newOpenAIKey}
              onChange={(e) => setNewOpenAIKey(e.target.value)}
              placeholder="sk-..."
              className="font-mono text-xs resize-none h-12 leading-relaxed"
              spellCheck={false}
            />
          </div>

          <Button
            onClick={() => saveOpenAIMutation.mutate(newOpenAIKey.trim())}
            disabled={!newOpenAIKey.trim() || saveOpenAIMutation.isPending}
            className="w-full sm:w-auto"
          >
            {saveOpenAIMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar chave"
            )}
          </Button>
        </div>
      </Card>

      <details className="mt-3 rounded-lg border border-border bg-muted/20">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium select-none">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Como pegar a API key da OpenAI
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-2 text-sm text-muted-foreground">
          <ol className="list-decimal ml-5 space-y-1.5">
            <li>
              Acesse{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                 className="text-primary underline underline-offset-2 inline-flex items-center gap-1">
                platform.openai.com/api-keys <ExternalLink className="h-3 w-3" />
              </a>{" "}
              e faça login (ou crie uma conta).
            </li>
            <li>Clique em <strong className="text-foreground">Create new secret key</strong>, dê um nome e confirme.</li>
            <li>Copie a chave (começa com <code className="bg-muted px-1 rounded text-[11px]">sk-</code>) — ela só aparece <strong className="text-foreground">uma vez</strong> — e cole aqui em cima.</li>
            <li>
              Garanta que a conta tem crédito: em{" "}
              <a href="https://platform.openai.com/settings/organization/billing" target="_blank" rel="noopener noreferrer"
                 className="text-primary underline underline-offset-2 inline-flex items-center gap-1">
                Billing <ExternalLink className="h-3 w-3" />
              </a>{" "}
              adicione um cartão / saldo. Sem crédito, o agente responde com erro de cota.
            </li>
          </ol>
          <p className="text-[11px]">A chave fica só nesta organização e nunca aparece de volta na tela — só os primeiros e últimos caracteres.</p>
        </div>
      </details>
    </section>
  );
}

const AGENT_MODE_LABEL: Record<string, string> = {
  trafego: "Tráfego",
  copy_automotivo: "Copy",
  roteiro_automotivo: "Roteiro",
};

function AssistantPromptDialog({ assistant }: { assistant: AssistantConfig }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(assistant.prompt);

  useEffect(() => {
    if (open) setDraft(assistant.prompt);
  }, [open, assistant.prompt]);

  const saveMutation = useMutation({
    mutationFn: (prompt: string) => agentSaveAssistantPrompt({ data: { mode: assistant.mode, prompt } }),
    onSuccess: () => {
      toast.success("Prompt do assistente salvo.");
      queryClient.invalidateQueries({ queryKey: ["agent-assistants"] });
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar prompt"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="shrink-0">Editar prompt</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prompt — assistente de {assistant.label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="font-mono text-xs leading-relaxed h-[340px] resize-none"
          />
          {assistant.mode === "trafego" && (
            <p className="text-[11px] text-muted-foreground">
              O bloco “Estado atual dos clientes” (CPL, gasto, leads, alertas) é anexado automaticamente no fim deste prompt a cada mensagem.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {assistant.isCustom
              ? "Você está usando um prompt personalizado — vale só pra você, não afeta os outros gestores."
              : "Você está usando o prompt padrão. Se editar, muda só pra você."}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => setDraft(assistant.defaultPrompt)}
            disabled={saveMutation.isPending || draft === assistant.defaultPrompt}
          >
            Carregar padrão
          </Button>
          <Button
            variant="outline"
            onClick={() => saveMutation.mutate("")}
            disabled={saveMutation.isPending || !assistant.isCustom}
          >
            Restaurar padrão
          </Button>
          <Button onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending || !draft.trim()}>
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentPinnedSection() {
  const queryClient = useQueryClient();

  const { data: assistants = [], isLoading: loadingAssistants } = useQuery({
    queryKey: ["agent-assistants"],
    queryFn: () => agentGetAssistants(),
    staleTime: 1000 * 60,
  });

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["agent-conversations"],
    queryFn: () => agentListConversations(),
    staleTime: 1000 * 30,
  });

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      agentSetConversationPinned({ data: { conversation_id: id, pinned } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-conversations"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao fixar conversa"),
  });

  const pinnedCount = conversations.filter((c) => c.pinned).length;

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Star className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Chats fixos do botão flutuante</h2>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/10 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            As abas do botão flutuante são os 3 assistentes abaixo. Fixe conversas pra elas ocuparem a frente
            (empurram os assistentes pra fora, até 3 no total).
          </p>
          <Badge variant="outline" className="shrink-0 tabular-nums">{pinnedCount} de 3 fixadas</Badge>
        </div>

        {/* Assistentes — padrão do botão flutuante, prompt editável */}
        <p className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Assistentes</p>
        <div className="divide-y divide-border">
          {loadingAssistants ? (
            <p className="px-5 py-3 text-sm text-muted-foreground">Carregando...</p>
          ) : (
            assistants.map((a) => (
              <div key={a.mode} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {a.isCustom ? "Prompt personalizado" : "Prompt padrão"}
                  </p>
                </div>
                <AssistantPromptDialog assistant={a} />
              </div>
            ))
          )}
        </div>

        {/* Conversas do gestor — fixar pra virar aba */}
        <p className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Conversas</p>
        <div className="divide-y divide-border">
          {isLoading ? (
            <p className="px-5 py-3 text-sm text-muted-foreground">Carregando conversas...</p>
          ) : conversations.length === 0 ? (
            <p className="px-5 py-3 text-sm text-muted-foreground">
              Você ainda não tem conversas com o agente.
            </p>
          ) : (
            conversations.map((c) => {
              const willReplace = !c.pinned && pinnedCount >= 3;
              return (
                <div key={c.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.title ?? "Conversa"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {AGENT_MODE_LABEL[c.mode] ?? c.mode} ·{" "}
                      {new Date(c.last_msg_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={c.pinned ? "default" : "outline"}
                    className="shrink-0 gap-1.5"
                    onClick={() => pinMutation.mutate({ id: c.id, pinned: !c.pinned })}
                    disabled={pinMutation.isPending}
                    title={willReplace ? "Vai desafixar a conversa fixada mais antiga" : undefined}
                  >
                    <Star className={`h-3.5 w-3.5 ${c.pinned ? "fill-current" : ""}`} />
                    {c.pinned ? "Fixado" : "Fixar"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </section>
  );
}

function N8nSection() {
  const queryClient = useQueryClient();
  const [newWebhookUrl, setNewWebhookUrl] = useState("");

  const { data: n8nWebhookUrl, isLoading: isLoadingN8n } = useQuery({
    queryKey: ["n8n-webhook-url"],
    queryFn: getN8nWebhookUrl,
    staleTime: 1000 * 60 * 5,
  });

  const saveN8nMutation = useMutation({
    mutationFn: saveN8nWebhookUrl,
    onSuccess: () => {
      toast.success("URL do webhook n8n salva!");
      setNewWebhookUrl("");
      queryClient.invalidateQueries({ queryKey: ["n8n-webhook-url"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar URL"),
  });

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Webhook className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Webhook n8n</h2>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-4 border-b border-border bg-muted/10">
          <Webhook className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            {isLoadingN8n ? (
              <p className="text-sm text-muted-foreground">Verificando...</p>
            ) : n8nWebhookUrl ? (
              <>
                <p className="text-sm font-medium text-status-on-target">Webhook configurado</p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{n8nWebhookUrl}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-destructive">Webhook não configurado</p>
                <p className="text-xs text-muted-foreground mt-0.5">Sem URL configurada — criação de anúncios usará chamada direta ao Meta.</p>
              </>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="n8n-webhook-input">{!n8nWebhookUrl ? "Cole a URL do webhook" : "Atualizar URL"}</Label>
            <Input
              id="n8n-webhook-input"
              value={newWebhookUrl}
              onChange={(e) => setNewWebhookUrl(e.target.value)}
              placeholder="https://seu-n8n.host/webhook/criar-anuncio"
              className="font-mono text-xs"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">URL de produção gerada pelo n8n no nó "Webhook — Receber Payload".</p>
          </div>

          <Button
            onClick={() => saveN8nMutation.mutate(newWebhookUrl.trim())}
            disabled={!newWebhookUrl.trim() || saveN8nMutation.isPending}
            className="w-full sm:w-auto"
          >
            {saveN8nMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar URL"
            )}
          </Button>
        </div>
      </Card>
    </section>
  );
}

function SendDestinationsSection() {
  const queryClient = useQueryClient();
  const { data: sendDestinations, isLoading: isLoadingSendDestinations } = useQuery({
    queryKey: ["send-destinations"],
    queryFn: getSendDestinations,
    staleTime: 1000 * 60 * 5,
  });

  const saveSendDestinationsMutation = useMutation({
    mutationFn: saveSendDestinations,
    onSuccess: () => {
      toast.success("Destino atualizado!");
      queryClient.invalidateQueries({ queryKey: ["send-destinations"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar destino"),
  });

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-1 w-1 rounded-full bg-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Destino dos envios manuais</h2>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Send className="h-5 w-5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Escolha pra onde vão as mensagens dos botões "Enviar lista de campanhas ativas" e "Enviar relatório
            semanal" na página do cliente. Se o destino for "Grupo do cliente" e o cliente ainda não tiver um
            grupo vinculado, a mensagem cai automaticamente no grupo Operacional.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Lista de campanhas ativas</Label>
            <Select
              value={sendDestinations?.campaignsListDestination ?? "operacional"}
              disabled={isLoadingSendDestinations || saveSendDestinationsMutation.isPending}
              onValueChange={(v) =>
                saveSendDestinationsMutation.mutate({
                  campaignsListDestination: v as SendDestination,
                  weeklyReportDestination: sendDestinations?.weeklyReportDestination ?? "operacional",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operacional">Operacional</SelectItem>
                <SelectItem value="client_group">Grupo do cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Relatório semanal (7 dias)</Label>
            <Select
              value={sendDestinations?.weeklyReportDestination ?? "operacional"}
              disabled={isLoadingSendDestinations || saveSendDestinationsMutation.isPending}
              onValueChange={(v) =>
                saveSendDestinationsMutation.mutate({
                  campaignsListDestination: sendDestinations?.campaignsListDestination ?? "operacional",
                  weeklyReportDestination: v as SendDestination,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operacional">Operacional</SelectItem>
                <SelectItem value="client_group">Grupo do cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>
    </section>
  );
}
