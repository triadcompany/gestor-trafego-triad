import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { exchangeGoogleCode } from "@/lib/google-calendar";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth/google/callback")({
  component: GoogleAuthCallback,
});

function GoogleAuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorParam = params.get("error");

    if (errorParam) {
      setError("Acesso negado. Tente novamente.");
      return;
    }

    if (!code) {
      navigate({ to: "/agenda" });
      return;
    }

    exchangeGoogleCode(code)
      .then(() => navigate({ to: "/agenda" }))
      .catch((err: Error) => setError(err.message));
  }, [navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 text-center px-4">
        <p className="text-destructive">{error}</p>
        <button
          className="text-sm text-primary underline"
          onClick={() => navigate({ to: "/agenda" })}
        >
          Voltar para a Agenda
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Conectando Google Agenda...</p>
    </div>
  );
}
