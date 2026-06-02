import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const fetchProfilesAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role")
    .order("full_name");
  if (error) throw error;
  return data ?? [];
});
