import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMetaToken, getMetaToken } from "@/lib/meta";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Login — Gestor de Tráfego" }],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Se já tem token válido, vai direto pro dashboard
  useEffect(() => {
    getMetaToken().then((t) => {
      if (t) navigate({ to: "/" });
    });
  }, [navigate]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setSaving(true);
    setError("");

    try {
      // Valida o token chamando /me
      const res = await fetch(
        `https://graph.facebook.com/v21.0/me?access_token=${token.trim()}`
      );
      const json = await res.json() as { name?: string; error?: { message: string } };

      if (json.error || !json.name) {
        throw new Error(json.error?.message ?? "Token inválido");
      }

      // Salva com 60 dias de validade
      const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000);
      await saveMetaToken(token.trim(), expiresAt);
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao validar token");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl mb-3">
            G
          </div>
          <h1 className="text-xl font-semibold">Gestor de Tráfego</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cole seu token de acesso Meta Ads
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1">
            <Label>Token de acesso</Label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAASR9J..."
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Gere em developers.facebook.com → Graph API Explorer com permissões{" "}
              <code>ads_read</code> e <code>ads_management</code>
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={saving || !token.trim()}>
            {saving ? "Validando..." : "Entrar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
