import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Facebook } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Login — Gestor de Tráfego" }],
  }),
  component: Login,
});

function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl mb-3">
            G
          </div>
          <h1 className="text-xl font-semibold">Gestor de Tráfego</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Painel de gestão Meta Ads
          </p>
        </div>
        <Button asChild className="w-full gap-2 bg-[#1877F2] hover:bg-[#1568d8] text-white">
          <Link to="/">
            <Facebook className="h-4 w-4 fill-current" />
            Entrar com Facebook
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground text-center mt-4">
          Acesso restrito ao administrador
        </p>
      </Card>
    </div>
  );
}
