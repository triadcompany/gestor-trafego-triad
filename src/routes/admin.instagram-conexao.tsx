import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Instagram, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { fetchInstagramConnection, upsertInstagramConnection, deleteInstagramConnection } from "@/server/instagram-funnel";

export const Route = createFileRoute("/admin/instagram-conexao")({
  head: () => ({ meta: [{ title: "Conexão Instagram — Admin" }] }),
  component: InstagramConexaoPage,
});

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function InstagramConexaoPage() {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const { data: connection, isLoading } = useQuery({
    queryKey: ["instagram-connection"],
    queryFn: fetchInstagramConnection,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertInstagramConnection({
        instagram_business_account_id: accountId.trim(),
        access_token: accessToken.trim(),
        expires_at: expiresAt || null,
      }),
    onSuccess: () => {
      toast.success("Conexão do Instagram salva.");
      setAccessToken("");
      queryClient.invalidateQueries({ queryKey: ["instagram-connection"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar conexão"),
  });

  const disconnectMutation = useMutation({
    mutationFn: deleteInstagramConnection,
    onSuccess: () => {
      toast.success("Instagram desconectado.");
      queryClient.invalidateQueries({ queryKey: ["instagram-connection"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao desconectar"),
  });

  const expiringSoon = connection?.expires_at && daysUntil(connection.expires_at) <= 7;

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Instagram className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Conexão Instagram</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Só pra conta da Triad Company — usada pelo{" "}
          <Link to="/admin/instagram-funil" className="underline underline-offset-2 hover:text-foreground">
            funil de comentário → DM
          </Link>
          .
        </p>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-4 border-b border-border bg-muted/10">
            <Instagram className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Verificando...</p>
              ) : connection ? (
                <>
                  <p className={`text-sm font-medium ${expiringSoon ? "text-status-attention" : "text-status-on-target"}`}>
                    {expiringSoon ? "Conectado — token expira em breve" : "Conectado"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">{connection.instagram_business_account_id}</p>
                  {connection.expires_at && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Token expira em {new Date(connection.expires_at).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-destructive">Não conectado</p>
                  <p className="text-xs text-muted-foreground mt-0.5">O funil não vai funcionar sem isso.</p>
                </>
              )}
            </div>
            {connection && !isLoading && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                disabled={disconnectMutation.isPending}
                onClick={() => {
                  if (confirm("Desconectar o Instagram? O funil para de funcionar até você conectar de novo — as regras e leads já salvos continuam intactos.")) {
                    disconnectMutation.mutate();
                  }
                }}
              >
                {disconnectMutation.isPending ? "Desconectando..." : "Desconectar"}
              </Button>
            )}
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ig-account-id">Instagram Business Account ID</Label>
              <Input
                id="ig-account-id"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder={connection?.instagram_business_account_id ?? "178414..."}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ig-token">{!connection ? "Access Token (longa duração)" : "Atualizar Access Token"}</Label>
              <Input
                id="ig-token"
                type="text"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="IGQ..."
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ig-expires">Data de expiração do token (opcional, ~60 dias)</Label>
              <Input id="ig-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!accountId.trim() || !accessToken.trim() || saveMutation.isPending}
              className="w-full sm:w-auto"
            >
              {saveMutation.isPending ? "Salvando..." : "Salvar conexão"}
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            Como gerar esses valores <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </p>
          <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>
              Pode usar o mesmo app do Meta Ads que vocês já têm em{" "}
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                developers.facebook.com/apps
              </a>{" "}
              — um app pode ter vários produtos. Só adicione o produto "Instagram" com "Instagram Login" nele (ou crie um app novo, se preferir separar).
            </li>
            <li>Adicione a conta da Triad Company como Admin/Tester do app — dispensa revisão do app da Meta.</li>
            <li>Gere um token de usuário do Instagram com as permissões <code className="text-xs bg-muted px-1 py-0.5 rounded">instagram_business_basic</code> e <code className="text-xs bg-muted px-1 py-0.5 rounded">instagram_business_manage_messages</code>, e troque por um de longa duração.</li>
            <li>O "Instagram Business Account ID" é o retornado por <code className="text-xs bg-muted px-1 py-0.5 rounded">GET /me?fields=id</code> usando esse token.</li>
            <li>
              No painel do app, em Webhooks, assine o campo <code className="text-xs bg-muted px-1 py-0.5 rounded">comments</code> do produto Instagram, apontando pra{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded break-all">https://[seu domínio]/api/webhooks/instagram</code>.
            </li>
          </ol>
        </Card>
      </div>
    </AppShell>
  );
}
