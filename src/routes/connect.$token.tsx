import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { fetchInstanceQrByToken, fetchInstanceStateByToken } from "@/lib/whatsapp-messages";

export const Route = createFileRoute("/connect/$token")({
  head: () => ({
    meta: [{ title: "Conectar WhatsApp" }],
  }),
  component: ConnectPage,
});

function ConnectPage() {
  const { token } = Route.useParams();
  const [qr, setQr] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const { data: stateData, error: stateError } = useQuery({
    queryKey: ["connect-state", token],
    queryFn: () => fetchInstanceStateByToken(token),
    refetchInterval: connected ? false : 3000,
    retry: false,
  });

  const { data: qrData, error: qrError, refetch: refetchQr } = useQuery({
    queryKey: ["connect-qr", token],
    queryFn: () => fetchInstanceQrByToken(token),
    enabled: !connected,
    retry: false,
  });

  useEffect(() => {
    if (qrData?.qrBase64) setQr(qrData.qrBase64);
  }, [qrData]);

  useEffect(() => {
    if (stateData?.state === "open") setConnected(true);
  }, [stateData]);

  // QR code expira depois de um tempo — rebusca sozinho a cada 30s enquanto não conectar.
  useEffect(() => {
    if (connected) return;
    const id = setInterval(() => refetchQr(), 30000);
    return () => clearInterval(id);
  }, [connected, refetchQr]);

  const invalidLink = stateError instanceof Error || qrError instanceof Error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center space-y-5">
        <h1 className="text-xl font-semibold text-foreground">Conectar WhatsApp</h1>

        {invalidLink ? (
          <div className="flex flex-col items-center gap-2 text-status-critical">
            <AlertCircle className="h-8 w-8" />
            <p className="text-sm">
              Esse link não é mais válido — pode já ter sido usado ou expirado. Peça um novo link.
            </p>
          </div>
        ) : connected ? (
          <div className="flex flex-col items-center gap-2 text-status-on-target">
            <CheckCircle2 className="h-12 w-12" />
            <p className="text-base font-medium text-foreground">WhatsApp conectado!</p>
            <p className="text-sm text-muted-foreground">Pode fechar esta página.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Abra o WhatsApp no celular → Configurações → Aparelhos conectados → Conectar um aparelho, e aponte a câmera pro código abaixo.
            </p>
            <div className="flex items-center justify-center rounded-lg border border-border bg-white p-4">
              {qr ? (
                <img src={qr} alt="QR code do WhatsApp" className="h-64 w-64" />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">O código atualiza sozinho enquanto não conectar.</p>
          </>
        )}
      </div>
    </div>
  );
}
