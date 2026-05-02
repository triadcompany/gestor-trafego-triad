import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Copy,
  Check,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Stethoscope,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { getTokenInfo, saveMetaToken, getOpenAIKey, saveOpenAIKey } from "@/lib/meta";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Configurações — Gestor de Tráfego" }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const [newToken, setNewToken] = useState("");
  const [newOpenAIKey, setNewOpenAIKey] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: tokenInfo, isLoading } = useQuery({
    queryKey: ["token-info"],
    queryFn: getTokenInfo,
    staleTime: 1000 * 60 * 5,
  });

  const saveMutation = useMutation({
    mutationFn: async (token: string) => {
      // Validate via /me
      const res = await fetch(
        `https://graph.facebook.com/v21.0/me?access_token=${token}`
      );
      const json = (await res.json()) as {
        name?: string;
        error?: { message: string };
      };
      if (json.error || !json.name) {
        throw new Error(json.error?.message ?? "Token inválido");
      }
      const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000);
      await saveMetaToken(token, expiresAt);
      return json.name;
    },
    onSuccess: (name) => {
      toast.success(`Token salvo! Conectado como ${name}.`);
      setNewToken("");
      queryClient.invalidateQueries({ queryKey: ["token-info"] });
      queryClient.invalidateQueries({ queryKey: ["last-synced-at"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar token");
    },
  });

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
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar chave");
    },
  });

  const maskedToken = tokenInfo?.token
    ? `${tokenInfo.token.slice(0, 10)}${"•".repeat(20)}${tokenInfo.token.slice(-6)}`
    : null;

  const handleCopy = () => {
    if (tokenInfo?.token) {
      navigator.clipboard.writeText(tokenInfo.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const tokenStatus = !tokenInfo?.token
    ? "missing"
    : (tokenInfo.daysUntilExpiry ?? 0) <= 0
    ? "expired"
    : (tokenInfo.daysUntilExpiry ?? 99) <= 7
    ? "expiring"
    : "ok";

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-8 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Gerencie o token de acesso ao Meta Ads e outras preferências do sistema.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/diagnostico-meta" className="gap-2">
              <Stethoscope className="h-4 w-4" />
              Ver diagnóstico Meta
            </Link>
          </Button>
        </div>

        {/* Token section */}
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Token do Meta
            </h2>
          </div>

          <Card className="overflow-hidden">
            {/* Status bar */}
            <div
              className={`px-5 py-4 flex items-center gap-4 border-b border-border ${
                tokenStatus === "ok"
                  ? "bg-green-500/5"
                  : tokenStatus === "expiring"
                  ? "bg-yellow-500/5"
                  : "bg-destructive/5"
              }`}
            >
              {isLoading ? (
                <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />
              ) : tokenStatus === "ok" ? (
                <ShieldCheck className="h-5 w-5 text-green-500 shrink-0" />
              ) : tokenStatus === "expiring" ? (
                <ShieldAlert className="h-5 w-5 text-yellow-500 shrink-0" />
              ) : (
                <ShieldX className="h-5 w-5 text-destructive shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Verificando token...</p>
                ) : tokenStatus === "ok" ? (
                  <>
                    <p className="text-sm font-medium text-green-500">Token ativo</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Expira em{" "}
                      <strong>{tokenInfo?.daysUntilExpiry} dias</strong>
                      {tokenInfo?.expiresAt && (
                        <> · {tokenInfo.expiresAt.toLocaleDateString("pt-BR")}</>
                      )}
                    </p>
                  </>
                ) : tokenStatus === "expiring" ? (
                  <>
                    <p className="text-sm font-medium text-yellow-500">
                      Expira em breve
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Restam <strong>{tokenInfo?.daysUntilExpiry} dias</strong> —
                      renove antes que os dados parem de sincronizar.
                    </p>
                  </>
                ) : tokenStatus === "expired" ? (
                  <>
                    <p className="text-sm font-medium text-destructive">Token expirado</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Sincronização pausada. Cole um novo token abaixo.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-destructive">Sem token</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Nenhum token configurado. Cole um abaixo para começar.
                    </p>
                  </>
                )}
              </div>

              {maskedToken && (
                <Badge variant="outline" className="font-mono text-xs shrink-0 hidden sm:flex items-center gap-1.5">
                  {maskedToken}
                  <button
                    onClick={handleCopy}
                    className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </Badge>
              )}
            </div>

            {/* Update form */}
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-input">
                  {tokenStatus === "missing" || tokenStatus === "expired"
                    ? "Cole o novo token"
                    : "Atualizar token"}
                </Label>
                <Textarea
                  id="token-input"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder="EAASR9JZBuCzIBO..."
                  className="font-mono text-xs resize-none h-20 leading-relaxed"
                  spellCheck={false}
                />
                <p className="text-[11px] text-muted-foreground">
                  O token será validado e salvo com validade de 60 dias.
                </p>
              </div>

              <Button
                onClick={() => saveMutation.mutate(newToken.trim())}
                disabled={!newToken.trim() || saveMutation.isPending}
                className="w-full sm:w-auto"
              >
                {saveMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Validando...
                  </>
                ) : (
                  "Salvar token"
                )}
              </Button>
            </div>

            <Separator />

            {/* Instructions */}
            <div className="p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Como obter o token
              </p>
              <ol className="space-y-3">
                {[
                  <>
                    Acesse o{" "}
                    <a
                      href="https://developers.facebook.com/tools/explorer/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2 inline-flex items-center gap-1"
                    >
                      Graph API Explorer
                      <ExternalLink className="h-3 w-3" />
                    </a>{" "}
                    e selecione seu app no topo.
                  </>,
                  <>
                    Clique em <strong>Add a Permission</strong> e marque{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-[11px]">ads_read</code>{" "}
                    e{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-[11px]">ads_management</code>.
                  </>,
                  <>
                    Clique em <strong>Generate Access Token</strong> e autorize o app.
                  </>,
                  <>
                    Para token de longa duração (60 dias), chame via URL ou cole o token
                    curto aqui — o sistema aceita ambos.
                  </>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                    <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-foreground shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-4 p-3 bg-muted/40 rounded-lg text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Token de longa duração manual:</strong>
                <br />
                <code className="break-all select-all">
                  {`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={TOKEN_CURTO}`}
                </code>
              </div>
            </div>
          </Card>
        </section>

        {/* OpenAI Key section */}
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              API Key do Agente (OpenAI)
            </h2>
          </div>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-4 border-b border-border bg-muted/10">
              <KeyRound className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                {isLoadingOpenAI ? (
                   <p className="text-sm text-muted-foreground">Verificando...</p>
                ) : openAIKey ? (
                  <>
                    <p className="text-sm font-medium text-green-500">Chave configurada</p>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                      {openAIKey.slice(0, 6)}...{openAIKey.slice(-4)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-destructive">Sem chave configurada</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      O agente de IA não poderá funcionar.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openai-input">
                  {!openAIKey ? "Cole a nova chave API" : "Atualizar chave API"}
                </Label>
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
        </section>

        {/* System info */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-1 w-1 rounded-full bg-muted-foreground" />
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Sistema
            </h2>
          </div>

          <Card className="divide-y divide-border">
            {[
              { label: "Versão", value: "0.1.0" },
              { label: "API Meta", value: "Graph API v21.0" },
              { label: "Sync automático", value: "A cada hora" },
              { label: "Dados armazenados", value: "Supabase (PostgreSQL)" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
