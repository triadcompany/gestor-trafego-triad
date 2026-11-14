import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchWhatsappNumbersForPage } from "@/server/facebook-directory";

// Números de WhatsApp da Business Manager da Página (precisa da permissão
// whatsapp_business_management — se não tiver, ou se a BM não tiver número
// cadastrado, ou se ainda não houver Página, cai pro campo de texto livre).
export function WhatsappNumberPicker({
  accountId,
  pageId,
  value,
  onChange,
}: {
  accountId: string | undefined;
  pageId: string | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: numbers = [], isLoading, isFetched } = useQuery({
    queryKey: ["fb-whatsapp-numbers-page", accountId, pageId],
    queryFn: () => fetchWhatsappNumbersForPage(accountId!, pageId!),
    enabled: !!pageId && !!accountId,
  });

  if (pageId && (isLoading || numbers.length > 0)) {
    const knownValue = numbers.some((n) => n.number === value) ? value : undefined;
    return (
      <Select value={knownValue} onValueChange={onChange} disabled={isLoading}>
        <SelectTrigger className="font-mono">
          <SelectValue placeholder={isLoading ? "Carregando números..." : "Selecionar número"} />
        </SelectTrigger>
        <SelectContent>
          {numbers.map((n) => (
            <SelectItem key={n.id} value={n.number}>{n.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      type="tel"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={pageId && isFetched ? "Nenhum número encontrado — digite manualmente" : "5511999999999"}
      className="font-mono"
    />
  );
}
