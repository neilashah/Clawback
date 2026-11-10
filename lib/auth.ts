import "server-only";
import { NextResponse } from "next/server";
import { isAllowed } from "./allowlist";
import { createClient } from "./supabase/server";

/** For API routes: returns the signed-in, allow-listed user or a 401 response. */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user || !isAllowed(user.email)) {
    return { user: null, error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { user, error: null } as const;
}
