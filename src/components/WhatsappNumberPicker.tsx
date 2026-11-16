import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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

  const [showAll, setShowAll] = useState(false);

  if (pageId && (isLoading || numbers.length > 0)) {
    // Só os números com vínculo comprovado com a Página; os que existem apenas na
    // Business Manager ficam escondidos (a Meta recusa se não estiverem vinculados).
    const linked = numbers.filter((n) => n.linked);
    const hiddenCount = numbers.length - linked.length;
    const noneLinked = !isLoading && linked.length === 0;
    const visible = showAll || noneLinked || numbers.find((n) => n.number === value && !n.linked) ? numbers : linked;
    const knownValue = visible.some((n) => n.number === value) ? value : undefined;
    return (
      <div className="space-y-1.5">
        <Select value={knownValue} onValueChange={onChange} disabled={isLoading}>
          <SelectTrigger className="font-mono">
            <SelectValue placeholder={isLoading ? "Carregando números..." : "Selecionar número"} />
          </SelectTrigger>
          <SelectContent>
            {visible.map((n) => (
              <SelectItem key={n.id} value={n.number}>{n.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {noneLinked && (
          <p className="text-xs text-amber-400">
            Nenhum número com vínculo comprovado a essa Página. Os da Business Manager podem ser recusados pela Meta se não estiverem vinculados.
          </p>
        )}
        {!noneLinked && hiddenCount > 0 && !showAll && (
          <button type="button" onClick={() => setShowAll(true)} className="text-xs text-muted-foreground underline hover:text-foreground">
            Mostrar também {hiddenCount} número{hiddenCount > 1 ? "s" : ""} só da Business Manager (podem não estar vinculados à Página)
          </button>
        )}
      </div>
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
