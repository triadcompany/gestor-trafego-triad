import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { getTokenInfo } from "@/lib/meta";

export function TokenExpiryBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["token-info"],
    queryFn: getTokenInfo,
    staleTime: 1000 * 60 * 60,
  });

  if (dismissed) return null;
  if (!data) return null;

  const { daysUntilExpiry } = data;

  if (daysUntilExpiry === null || daysUntilExpiry > 7) return null;

  const expired = daysUntilExpiry <= 0;

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
        expired
          ? "bg-destructive/15 text-destructive border-b border-destructive/20"
          : "bg-yellow-500/10 text-yellow-400 border-b border-yellow-500/20"
      }`}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {expired ? (
          <span>
            Token Meta expirado.{" "}
            <Link to="/settings" className="underline font-medium">
              Renove agora
            </Link>{" "}
            para continuar sincronizando os dados.
          </span>
        ) : (
          <span>
            Token Meta expira em <strong>{daysUntilExpiry} dia{daysUntilExpiry !== 1 ? "s" : ""}</strong>.{" "}
            <Link to="/settings" className="underline font-medium">
              Renove antes de expirar.
            </Link>
          </span>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 opacity-70 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
