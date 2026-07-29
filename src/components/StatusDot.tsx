import { cn } from "@/lib/utils";
import type { ClientStatus } from "@/lib/database.types";
import { statusColorClass } from "@/lib/status-colors";

export function StatusDot({ status, className }: { status: ClientStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        statusColorClass[status],
        className
      )}
    />
  );
}
