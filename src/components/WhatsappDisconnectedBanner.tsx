import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { WifiOff, X } from "lucide-react";
import { useState } from "react";
import { fetchDisconnectedInstances } from "@/lib/whatsapp-messages";

export function WhatsappDisconnectedBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["disconnected-instances"],
    queryFn: fetchDisconnectedInstances,
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });

  if (dismissed) return null;
  if (!data || data.length === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/15 px-4 py-2.5 text-sm text-destructive">
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          Instância{data.length > 1 ? "s" : ""} de WhatsApp desconectada{data.length > 1 ? "s" : ""}:{" "}
          <strong>{data.join(", ")}</strong>.{" "}
          <Link to="/settings" className="underline font-medium">
            Reconectar
          </Link>
        </span>
      </div>
      <button onClick={() => setDismissed(true)} className="shrink-0 opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
