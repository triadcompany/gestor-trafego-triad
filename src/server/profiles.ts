import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";

export const fetchProfilesAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db
    .select({ id: profiles.id, full_name: profiles.fullName, role: profiles.role })
    .from(profiles)
    .orderBy(profiles.fullName);
  return rows;
});
