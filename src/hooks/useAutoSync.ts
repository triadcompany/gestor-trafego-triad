import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { triggerMetaSync } from "@/server/meta-sync";
import { getLastSyncedAt } from "@/lib/meta";

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

export function useAutoSync() {
  const queryClient = useQueryClient();
  const syncing = useRef(false);

  useEffect(() => {
    async function checkAndSync() {
      if (syncing.current) return;

      const lastSync = await getLastSyncedAt();
      const stale = !lastSync || Date.now() - lastSync.getTime() > SYNC_INTERVAL_MS;

      if (!stale) return;

      syncing.current = true;
      try {
        await triggerMetaSync();
        queryClient.invalidateQueries({ queryKey: ["clients-dashboard"] });
      } catch {
        // silencioso — erros aparecem no botão manual
      } finally {
        syncing.current = false;
      }
    }

    checkAndSync();

    // Verifica a cada hora se precisa sincronizar novamente
    const interval = setInterval(checkAndSync, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [queryClient]);
}
