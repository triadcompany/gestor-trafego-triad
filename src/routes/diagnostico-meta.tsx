import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Stethoscope,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  runMetaDiagnostics,
  clearLastMetaError,
  type PermissionStatus,
} from "@/lib/meta";

export const Route = createFileRoute("/diagnostico-meta")({
  head: () => ({
    meta: [{ title: "Diagnóstico Meta — Gestor de Tráfego" }],
  }),
  component: DiagnosticoMetaPage,
});

function DiagnosticoMetaPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["meta-diagnostics"],
    queryFn: runMetaDiagnostics,
    staleTime: 1000 * 30,
  });

  const clearMutation = useMutation({
    mutationFn: clearLastMetaError,
    onSuccess: () => {
      toast.success("Última resposta de erro limpa.");
      queryClient.invalidateQueries({ queryKey: ["meta-diagnostics"] });
    },
  });

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-8 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Stethoscope className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Diagnóstico Meta Ads
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Verifica token, permissões, contas de anúncios e a última resposta
              de erro retornada pela API da Meta.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Executar diagnóstico
          </Button>
        </div>

        {isLoading || !data ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Carregando diagnóstico...
          </Card>
        ) : (
          <div className="space-y-5">
            {/* Token */}
            <Section title="Token atual" icon={<ShieldCheck className="h-4 w-4" />}>
              <Card className="p-5 space-y-3">
                {!data.hasToken ? (
                  <Row
                    icon={<ShieldX className="h-4 w-4 text-destructive" />}
                    label="Sem token"
                    value={
                      <Link to="/settings" className="text-primary underline">
                        Configurar agora
                      </Link>
                    }
                  />
                ) : data.tokenError ? (
                  <>
                    <Row
                      icon={<ShieldX className="h-4 w-4 text-destructive" />}
                      label="Token inválido"
                      value={data.tokenError}
                    />
                    <Row label="Token (mascarado)" value={data.maskedToken ?? "—"} mono />
                  </>
                ) : (
                  <>
                    <Row
                      icon={<ShieldCheck className="h-4 w-4 text-green-500" />}
                      label="Conectado como"
                      value={
                        data.user
                          ? `${data.user.name} (id ${data.user.id})`
                          : "Desconhecido"
                      }
                    />
                    <Row label="Token (mascarado)" value={data.maskedToken ?? "—"} mono />
                    <Row
                      label="Expira em"
                      value={
                        data.daysUntilExpiry !== null && data.expiresAt
                          ? `${data.daysUntilExpiry} dias · ${data.expiresAt.toLocaleDateString(
                              "pt-BR"
                            )}`
                          : "—"
                      }
                    />
                  </>
                )}
              </Card>
            </Section>

            {/* Permissions */}
            <Section
              title="Permissões do token"
              icon={<ShieldAlert className="h-4 w-4" />}
            >
              <Card className="divide-y divide-border">
                {data.permissions.map((p) => (
                  <div
                    key={p.permission}
                    className="flex items-start justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-sm">{p.permission}</code>
                        {p.required && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            obrigatória
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {p.description}
                      </p>
                    </div>
                    <PermissionBadge status={p.status} />
                  </div>
                ))}
              </Card>
            </Section>

            {/* Ad accounts */}
            <Section
              title="Contas de anúncios visíveis"
              icon={<ShieldCheck className="h-4 w-4" />}
            >
              <Card className="p-5">
                {data.adAccountsError ? (
                  <p className="text-sm text-destructive">{data.adAccountsError}</p>
                ) : data.adAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma conta de anúncios visível para este token.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-3">
                      <strong className="text-foreground">{data.adAccounts.length}</strong>{" "}
                      conta{data.adAccounts.length === 1 ? "" : "s"} acessível
                      {data.adAccounts.length === 1 ? "" : "is"}.
                    </p>
                    <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
                      {data.adAccounts.slice(0, 50).map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{a.name}</div>
                            <code className="font-mono text-[11px] text-muted-foreground">
                              {a.id}
                            </code>
                          </div>
                          <AccountStatusBadge status={a.account_status} />
                        </div>
                      ))}
                      {data.adAccounts.length > 50 && (
                        <div className="px-3 py-2 text-[11px] text-muted-foreground">
                          +{data.adAccounts.length - 50} contas ocultas
                        </div>
                      )}
                    </div>
                  </>
                )}
              </Card>
            </Section>

            {/* Last error */}
            <Section
              title="Última resposta da API"
              icon={<AlertTriangle className="h-4 w-4" />}
            >
              <Card className="p-5">
                {!data.lastError ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma falha registrada. Quando uma chamada de criação ou
                    duplicação falhar, ela aparecerá aqui.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <Row label="Endpoint" value={data.lastError.endpoint} mono />
                      <Row label="Status HTTP" value={String(data.lastError.status)} />
                      <Row
                        label="Código Meta"
                        value={
                          data.lastError.code !== undefined
                            ? String(data.lastError.code)
                            : "—"
                        }
                      />
                      <Row label="Tipo" value={data.lastError.type ?? "—"} />
                      <Row label="fbtrace_id" value={data.lastError.fbtrace_id ?? "—"} mono />
                      <Row
                        label="Quando"
                        value={new Date(data.lastError.at).toLocaleString("pt-BR")}
                      />
                    </div>
                    <Separator />
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                        Mensagem
                      </p>
                      <p className="text-sm">{data.lastError.message}</p>
                      {data.lastError.error_user_msg && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {data.lastError.error_user_msg}
                        </p>
                      )}
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => clearMutation.mutate()}
                        disabled={clearMutation.isPending}
                        className="gap-2 text-muted-foreground"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Limpar registro
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </Section>

            {/* Hints */}
            <Section
              title="Diagnóstico provável"
              icon={<Stethoscope className="h-4 w-4" />}
            >
              <Card className="p-5 space-y-2">
                {data.hints.map((h, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-foreground shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{h}</span>
                  </div>
                ))}

                <Separator className="my-2" />

                <p className="text-xs text-muted-foreground">
                  Atalhos úteis:
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://developers.facebook.com/tools/explorer/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Graph API Explorer
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://developers.facebook.com/apps/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Meus Apps Meta
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://business.facebook.com/settings"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Business Manager
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/settings" className="gap-1.5">
                      Atualizar token
                    </Link>
                  </Button>
                </div>
              </Card>
            </Section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3 text-muted-foreground">
        {icon}
        <h2 className="text-sm font-medium uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Row({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground shrink-0">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`text-right min-w-0 truncate ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function PermissionBadge({ status }: { status: PermissionStatus }) {
  if (status === "granted") {
    return (
      <Badge className="bg-green-500/15 text-green-500 border-green-500/30 hover:bg-green-500/15 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        concedida
      </Badge>
    );
  }
  if (status === "declined") {
    return (
      <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15 gap-1">
        <XCircle className="h-3 w-3" />
        recusada
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground gap-1">
      <AlertTriangle className="h-3 w-3" />
      ausente
    </Badge>
  );
}

function AccountStatusBadge({ status }: { status: number }) {
  const map: Record<number, { label: string; className: string }> = {
    1: { label: "ativa", className: "bg-green-500/15 text-green-500 border-green-500/30" },
    2: { label: "desativada", className: "bg-destructive/15 text-destructive border-destructive/30" },
    3: { label: "não entregue", className: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" },
    7: { label: "revisão", className: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" },
    9: { label: "em vencimento", className: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" },
    100: { label: "fechada", className: "bg-muted text-muted-foreground" },
  };
  const m = map[status] ?? { label: `status ${status}`, className: "bg-muted text-muted-foreground" };
  return <Badge variant="outline" className={`${m.className} text-[10px]`}>{m.label}</Badge>;
}
