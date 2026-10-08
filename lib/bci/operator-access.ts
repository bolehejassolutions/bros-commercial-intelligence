import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireBciOperator() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  const { data: allowed, error } = await supabase.rpc("is_bci_operator");
  if (error || allowed !== true) redirect("/access-denied");
  return { supabase, user };
}
