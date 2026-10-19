import { createClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error(
    "createServiceClient cannot be used in the browser: SUPABASE_SERVICE_ROLE_KEY must remain server-side"
  );
}

export function createServiceClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceClient cannot be used in the browser: SUPABASE_SERVICE_ROLE_KEY must remain server-side"
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase service environment variables");
  }

  // SERVICE_ROLE: Bypass RLS for server-side background processing (webhook handler, cron review queue, repo sync)
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
