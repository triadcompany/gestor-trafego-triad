import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generatePublicTrackingLink, revokePublicTrackingLink } from "@/server/lead-attribution";

// Botão de gerar/copiar/revogar o link público de rastreamento (/r/$token)
// desse cliente — usado tanto na página do cliente quanto na de
// Rastreamento, pra não duplicar a lógica de geração/cópia/revogação.
export function PublicTrackingLinkControl({
  clientId,
  publicTrackingToken,
  invalidateQueryKey,
  compact = false,
}: {
  clientId: string;
  publicTrackingToken: string | null;
  invalidateQueryKey: unknown[];
  compact?: boolean;
}) {
  const queryClient = useQueryClient();

  const copyLink = (t: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/r/${t}`);
    toast.success("Link copiado!");
  };

  const generateLinkMutation = useMutation({
    mutationFn: () => generatePublicTrackingLink(clientId),
    onSuccess: (t) => {
      copyLink(t);
      queryClient.invalidateQueries({ queryKey: invalidateQueryKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao gerar link"),
  });

  const revokeLinkMutation = useMutation({
    mutationFn: () => revokePublicTrackingLink(clientId),
    onSuccess: () => {
      toast.success("Link revogado — quem tinha o link antigo não acessa mais.");
      queryClient.invalidateQueries({ queryKey: invalidateQueryKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao revogar link"),
  });

  return (
    <div className={compact ? "flex flex-wrap items-center gap-1.5" : "flex items-center justify-between gap-2 flex-wrap rounded-lg border border-border px-3 py-2.5"}>
      {!compact && (
        <div className="flex items-center gap-2 min-w-0">
          <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground truncate">
            {publicTrackingToken
              ? "Link pra esse cliente acompanhar os leads e marcar qualificado/venda, sem precisar de login."
              : "Gere um link pra esse cliente acompanhar os leads e marcar qualificado/venda, sem precisar de login."}
          </p>
        </div>
      )}
      <div className="flex items-center gap-1.5 shrink-0">
        {publicTrackingToken && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => copyLink(publicTrackingToken)}>
            <Copy className="h-3.5 w-3.5" /> Copiar link
          </Button>
        )}
        <Button
          variant={publicTrackingToken ? "outline" : "default"}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => {
            if (publicTrackingToken && !confirm("Gerar um novo link invalida o link atual — quem já tem o link antigo perde acesso. Continuar?")) return;
            generateLinkMutation.mutate();
          }}
          disabled={generateLinkMutation.isPending}
        >
          <RefreshCw className="h-3.5 w-3.5" /> {publicTrackingToken ? "Gerar novo" : "Gerar link"}
        </Button>
        {publicTrackingToken && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm("Revogar o link? Quem já tem o link atual perde acesso imediatamente.")) revokeLinkMutation.mutate();
            }}
            disabled={revokeLinkMutation.isPending}
          >
            Revogar
          </Button>
        )}
      </div>
    </div>
  );
}
