import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { isAllowed } from "@/lib/allowlist";
import { PLAID_ENV } from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAllowed(data.user.email)) redirect("/login");
  return <Dashboard email={data.user.email ?? ""} plaidEnv={PLAID_ENV} />;
}
