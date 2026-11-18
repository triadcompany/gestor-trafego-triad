import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fetchSetupProgress } from "@/server/setup-progress";

type StepKey = "facebook" | "clientes" | "whatsapp" | "conversoes";

interface Step {
  key: StepKey;
  title: string;
  description: string;
  done: boolean;
  /** Impede o clique e explica o porquê (ex.: falta ter um cliente). */
  blockedReason?: string;
}

// Lista de primeiros passos do Dashboard: guia o gestor na ordem certa e some quando
// tudo está feito. É uma sequência de verdade (cada passo prepara o próximo).
export function SetupChecklist() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["setup-progress"], queryFn: fetchSetupProgress, staleTime: 30_000 });
  if (!data) return null;

  const noClients = data.clientCount === 0;
  const steps: Step[] = [
    {
      key: "facebook",
      title: "Conectar o Facebook",
      description: "Entre com o Facebook pra o sistema enxergar suas contas de anúncio.",
      done: data.hasFacebook,
    },
    {
      key: "clientes",
      title: "Importar seus clientes",
      description: "Traga as contas de anúncio que você gerencia e transforme em clientes.",
      done: data.clientCount > 0,
    },
    {
      key: "whatsapp",
      title: "Conectar o WhatsApp dos clientes",
      description: "Conecte o número e vincule a um cliente. É por ele que o sistema lê as conversas dos leads.",
      done: data.whatsappClientCount > 0,
    },
    {
      key: "conversoes",
      title: "Configurar as conversões",
      description: "Diga como o sistema descobre um lead qualificado e uma compra, pra a Meta otimizar seus anúncios.",
      done: data.conversionsClientCount > 0,
      blockedReason: noClients ? "Importe um cliente primeiro." : undefined,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const nextKey = steps.find((s) => !s.done)?.key;

  const go = (key: StepKey) => {
    switch (key) {
      case "facebook":
        navigate({ to: "/settings", search: { aba: "meta" } });
        return;
      case "clientes":
        navigate({ to: "/clients/importar" });
        return;
      case "whatsapp":
        navigate({ to: "/settings", search: { aba: "whatsapp" } });
        return;
      case "conversoes":
        if (data.nextConversionsClientId) navigate({ to: "/conversoes/$id", params: { id: data.nextConversionsClientId } });
        return;
    }
  };

  return (
    <Card className="p-5 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Primeiros passos</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Siga na ordem pra deixar tudo funcionando.</p>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums shrink-0">
          {doneCount} de {steps.length}
        </span>
      </div>
      <Progress value={(doneCount / steps.length) * 100} className="h-1.5 mt-3" aria-label={`${doneCount} de ${steps.length} passos feitos`} />

      <ol className="mt-4 space-y-2">
        {steps.map((step, i) => {
          const isNext = step.key === nextKey;
          return (
            <li
              key={step.key}
              className={cn("flex items-center gap-3 rounded-md border px-3 py-3", isNext ? "border-primary/40 bg-primary/5" : "border-transparent")}
            >
              {step.done ? (
                <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-label="Feito" />
              ) : (
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                    isNext ? "border-primary text-primary" : "text-muted-foreground"
                  )}
                  aria-hidden
                >
                  {i + 1}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className={cn("text-sm font-medium", step.done && "text-muted-foreground")}>{step.title}</div>
                {!step.done && (
                  <p className="text-xs text-muted-foreground mt-0.5">{step.blockedReason ?? step.description}</p>
                )}
              </div>
              {!step.done && (
                <Button size="sm" variant={isNext ? "default" : "outline"} className="shrink-0" disabled={!!step.blockedReason} onClick={() => go(step.key)}>
                  {isNext ? "Fazer agora" : "Abrir"}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
