import { syncAllClients, getMetaToken } from "@/lib/meta";

export async function triggerMetaSync() {
  const token = await getMetaToken();
  if (!token) throw new Error("Token Meta não encontrado. Acesse /login para configurar.");
  return syncAllClients(token);
}
