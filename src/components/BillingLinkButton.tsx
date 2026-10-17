import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getClientBillingUrl } from "@/lib/meta";

// Botão de "ir pra cobrança" de uma conta de anúncio. O link não pode ser um
// <a href> estático — o business_id certo depende de qual Business Manager é
// dono daquela conta especificamente (cada cliente tem o seu, não é um só
// compartilhado), então busca na hora do clique via getClientBillingUrl.
export function BillingLinkButton({ clientId, className }: { clientId: string; className?: string }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const url = await getClientBillingUrl(clientId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao abrir a cobrança desse cliente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={
        className ??
        "p-1.5 rounded-md bg-muted/50 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-50"
      }
      title="Ir para página de cobrança"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
    </button>
  );
}
