import { createServerFn } from "@tanstack/react-start";
import { syncAllClients } from "@/lib/meta";

export const triggerMetaSync = createServerFn({ method: "POST" }).handler(async () => {
  return syncAllClients();
});
