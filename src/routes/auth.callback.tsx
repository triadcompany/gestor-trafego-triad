import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { completeMetaOAuth } from "@/server/meta-oauth";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Conectando com a Meta..." }] }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const ran = useRef(false);
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [message, setMessage] = useState("Conectando sua conta da Meta...");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error_description") || params.get("error");

    if (oauthError) {
      setStatus("error");
      setMessage(oauthError);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("Link de retorno da Meta incompleto.");
      return;
    }

    completeMetaOAuth(code, state)
      .then(({ name }) => {
        setStatus("success");
        setMessage(`Conectado como ${name}!`);
        setTimeout(() => navigate({ to: "/settings" }), 1200);
      })
      .catch((e) => {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Erro ao conectar com a Meta.");
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-3">
        {status === "loading" && <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />}
        {status === "success" && <CheckCircle2 className="h-8 w-8 mx-auto text-status-on-target" />}
        {status === "error" && <XCircle className="h-8 w-8 mx-auto text-destructive" />}
        <p className="text-sm text-muted-foreground">{message}</p>
        {status === "error" && (
          <button
            onClick={() => navigate({ to: "/settings" })}
            className="text-sm underline underline-offset-2 text-primary"
          >
            Voltar pra Configurações
          </button>
        )}
      </div>
    </div>
  );
}
