import { createServerFn } from "@tanstack/react-start";
import { getMetaToken, syncAllClients } from "@/lib/meta";

export const triggerMetaSync = createServerFn({ method: "POST" }).handler(async () => {
  const token = await getMetaToken();
  if (!token) throw new Error("Token Meta não encontrado. Acesse /login para configurar.");
  return syncAllClients(token);
});
