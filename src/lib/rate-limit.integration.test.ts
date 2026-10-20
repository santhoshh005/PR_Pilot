import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit } from "./rate-limit";
import { createServiceClient } from "./supabase/service";

function getLiveConfig() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const fileEnv: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        fileEnv[key] = val;
      }
    }
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

  return { supabaseUrl, serviceKey };
}

const { supabaseUrl, serviceKey } = getLiveConfig();
const canRunLive = Boolean(supabaseUrl && serviceKey);

describe("Live Supabase Rate Limiter Integration Test", () => {
  let supabase: SupabaseClient | null = null;
  const testKey = `test:live-rate-limit-${crypto.randomUUID()}`;

  beforeAll(() => {
    if (canRunLive) {
      supabase = createClient(supabaseUrl!, serviceKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  });

  afterAll(async () => {
    if (!supabase) return;

    // Strictly delete only the row created by this test, identified by exact key
    await supabase.from("rate_limits").delete().eq("key", testKey);

    // Verify user profile row still exists
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, github_username");
    expect(error).toBeNull();
    expect(profiles?.length).toBeGreaterThan(0);
  });

  it.skipIf(!canRunLive)(
    "atomically tracks limits, blocks on third attempt, and cleans up by exact ID",
    async () => {
      // 1st request: limit 2
      const res1 = await checkRateLimit(testKey, 2, 60, {
        client: supabase! as unknown as ReturnType<typeof createServiceClient>,
      });
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(1);

      // 2nd request: limit 2
      const res2 = await checkRateLimit(testKey, 2, 60, {
        client: supabase! as unknown as ReturnType<typeof createServiceClient>,
      });
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(0);

      // 3rd request: exceeds limit
      const res3 = await checkRateLimit(testKey, 2, 60, {
        client: supabase! as unknown as ReturnType<typeof createServiceClient>,
      });
      expect(res3.allowed).toBe(false);
      expect(res3.remaining).toBe(0);
      expect(res3.retryAfter).toBeGreaterThan(0);

      // Check directly in rate_limits table
      const { data: rows, error: selectErr } = await supabase!
        .from("rate_limits")
        .select("key, count, reset_at")
        .eq("key", testKey);

      expect(selectErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows![0].key).toBe(testKey);
      expect(rows![0].count).toBe(3);
    },
    15000
  );
});
