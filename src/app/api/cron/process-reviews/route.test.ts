import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST, cleanupOldWebhookDeliveries } from "./route";
import * as processor from "@/lib/review/processor";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// Mock in-memory DB for unit/route tests
let mockDb: {
  review_jobs: any[];
  daily_api_usage: any[];
  webhook_deliveries: any[];
};

function resetMockDb() {
  mockDb = {
    review_jobs: [],
    daily_api_usage: [],
    webhook_deliveries: [],
  };
}

function createMockSupabaseClient() {
  return {
    from: (table: string) => {
      let currentTable = mockDb[table as keyof typeof mockDb] || [];
      let filters: Array<(row: any) => boolean> = [];
      let pendingUpdate: any = null;
      let isDelete = false;

      const chain: any = {
        select: () => chain,
        eq: (field: string, value: any) => {
          filters.push((row) => row[field] === value);
          return chain;
        },
        lt: (field: string, value: any) => {
          filters.push((row) => row[field] < value);
          return chain;
        },
        delete: () => {
          isDelete = true;
          return chain;
        },
        maybeSingle: async () => {
          const rows = currentTable.filter((row: any) =>
            filters.every((f) => f(row))
          );
          return { data: rows[0] || null, error: null };
        },
        single: async () => {
          const rows = currentTable.filter((row: any) =>
            filters.every((f) => f(row))
          );
          return { data: rows[0] || null, error: rows.length ? null : new Error("Not found") };
        },
        update: (values: any) => {
          pendingUpdate = values;
          return chain;
        },
        then: (resolve: any) => {
          if (isDelete) {
            const toDelete = currentTable.filter((row: any) =>
              filters.every((f) => f(row))
            );
            mockDb[table as keyof typeof mockDb] = currentTable.filter(
              (row: any) => !toDelete.includes(row)
            );
            return resolve({ data: toDelete, error: null });
          }
          if (pendingUpdate) {
            currentTable.forEach((row: any) => {
              if (filters.every((f) => f(row))) {
                Object.assign(row, pendingUpdate);
              }
            });
            return resolve({ data: null, error: null });
          }
          const rows = currentTable.filter((row: any) =>
            filters.every((f) => f(row))
          );
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
    rpc: async (fn: string, params?: any) => {
      if (fn === "claim_review_jobs") {
        const claimLimit = params?.claim_limit ?? 3;
        const staleSeconds = params?.stale_seconds ?? 180;
        const includeDeferred = params?.include_deferred ?? false;
        const maxRetries = params?.max_retries ?? 5;
        const now = Date.now();

        // 1. Mark jobs exceeding max_retries as failed
        mockDb.review_jobs.forEach((j) => {
          if (
            ["pending", "processing", "deferred", "queued"].includes(j.status) &&
            j.retry_count >= maxRetries
          ) {
            j.status = "failed";
            j.error_message = j.error_message || "Max retries reached";
            j.completed_at = new Date().toISOString();
          }
        });

        // 2. Find candidate jobs
        const candidates = mockDb.review_jobs.filter((j) => {
          if (j.retry_count >= maxRetries) return false;
          if (j.status === "pending" || j.status === "queued") return true;
          if (j.status === "deferred" && includeDeferred) return true;
          if (j.status === "processing") {
            const started = j.started_at ? new Date(j.started_at).getTime() : 0;
            return now - started > staleSeconds * 1000;
          }
          return false;
        });

        const claimed = candidates.slice(0, claimLimit);
        claimed.forEach((j) => {
          if (j.status === "processing") {
            j.retry_count += 1;
          }
          j.status = "processing";
          j.started_at = new Date().toISOString();
        });

        return { data: claimed, error: null };
      }
      if (fn === "cleanup_old_webhook_deliveries") {
        const days = params?.days ?? 7;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const referencedDeliveryIds = new Set(
          mockDb.review_jobs.map((j) => j.delivery_id).filter(Boolean)
        );
        const toDelete = mockDb.webhook_deliveries.filter((d) =>
          d.received_at < cutoff && !referencedDeliveryIds.has(d.delivery_id)
        );
        mockDb.webhook_deliveries = mockDb.webhook_deliveries.filter(
          (d) => !toDelete.includes(d)
        );
        return { data: toDelete.length, error: null };
      }
      return { data: null, error: null };
    },
  };
}

const mockSupabase = createMockSupabaseClient();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

describe("POST /api/cron/process-reviews", () => {
  const TEST_SECRET = "super-secret-cron-key-12345678901234";

  beforeEach(() => {
    resetMockDb();
    vi.restoreAllMocks();
    process.env.CRON_SECRET = TEST_SECRET;
    delete process.env.GEMINI_DAILY_LIMIT;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.GEMINI_DAILY_LIMIT;
  });

  it("wrong or missing secret returns 401 with no details", async () => {
    // 1. Missing header
    const reqNoAuth = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
    });
    const resNoAuth = await POST(reqNoAuth);
    expect(resNoAuth.status).toBe(401);
    const bodyNoAuth = await resNoAuth.json();
    expect(bodyNoAuth).toEqual({ error: "unauthorized" });

    // 2. Wrong token
    const reqWrong = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const resWrong = await POST(reqWrong);
    expect(resWrong.status).toBe(401);

    // 3. Invalid scheme
    const reqBasic = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    const resBasic = await POST(reqBasic);
    expect(resBasic.status).toBe(401);
  });

  it("happy path: claims pending jobs, calls processReview, and returns processed count", async () => {
    mockDb.review_jobs.push({
      id: "job-1",
      status: "pending",
      retry_count: 0,
      created_at: new Date().toISOString(),
    });

    const processSpy = vi.spyOn(processor, "processReview").mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed).toBe(1);
    expect(data.jobs).toEqual(["job-1"]);
    expect(processSpy).toHaveBeenCalledWith("job-1");
  });

  it("stale processing job (>3 min) is recovered and retried", async () => {
    const staleTime = new Date(Date.now() - 4 * 60 * 1000).toISOString(); // 4 minutes ago
    mockDb.review_jobs.push({
      id: "job-stale",
      status: "processing",
      started_at: staleTime,
      retry_count: 1,
      created_at: staleTime,
    });

    const processSpy = vi.spyOn(processor, "processReview").mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed).toBe(1);
    expect(data.jobs).toEqual(["job-stale"]);
    expect(processSpy).toHaveBeenCalledWith("job-stale");

    const job = mockDb.review_jobs.find((j) => j.id === "job-stale");
    expect(job?.retry_count).toBe(2);
  });

  it("deferred job waits when daily budget is exhausted", async () => {
    process.env.GEMINI_DAILY_LIMIT = "10";
    const today = new Date().toISOString().slice(0, 10);
    mockDb.daily_api_usage.push({
      usage_date: today,
      call_count: 10, // at limit
    });

    mockDb.review_jobs.push({
      id: "job-deferred",
      status: "deferred",
      retry_count: 0,
      created_at: new Date().toISOString(),
    });

    const processSpy = vi.spyOn(processor, "processReview").mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed).toBe(0);
    expect(processSpy).not.toHaveBeenCalled();

    const job = mockDb.review_jobs.find((j) => j.id === "job-deferred");
    expect(job?.status).toBe("deferred");
  });

  it("deferred job is picked up when budget remains", async () => {
    process.env.GEMINI_DAILY_LIMIT = "10";
    const today = new Date().toISOString().slice(0, 10);
    mockDb.daily_api_usage.push({
      usage_date: today,
      call_count: 5, // below limit
    });

    mockDb.review_jobs.push({
      id: "job-deferred-ok",
      status: "deferred",
      retry_count: 0,
      created_at: new Date().toISOString(),
    });

    const processSpy = vi.spyOn(processor, "processReview").mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed).toBe(1);
    expect(data.jobs).toEqual(["job-deferred-ok"]);
    expect(processSpy).toHaveBeenCalledWith("job-deferred-ok");
  });

  it("max-attempts job becomes failed with reason recorded", async () => {
    mockDb.review_jobs.push({
      id: "job-exhausted",
      status: "pending",
      retry_count: 5, // max attempts
      error_message: null,
      created_at: new Date().toISOString(),
    });

    const processSpy = vi.spyOn(processor, "processReview").mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed).toBe(0);
    expect(processSpy).not.toHaveBeenCalled();

    const job = mockDb.review_jobs.find((j) => j.id === "job-exhausted");
    expect(job?.status).toBe("failed");
    expect(job?.error_message).toBe("Max retries reached");
  });

  it("stops claiming new jobs when the 250s deadline is nearly used", async () => {
    mockDb.review_jobs.push(
      { id: "job-fast", status: "pending", retry_count: 0, created_at: new Date().toISOString() },
      { id: "job-skip-budget", status: "pending", retry_count: 0, created_at: new Date().toISOString() }
    );

    let calls = 0;
    vi.spyOn(processor, "processReview").mockImplementation(async (id: string) => {
      calls++;
      // Fast forward time past the 250s budget
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 230_000);
    });

    const req = new Request("http://localhost/api/cron/process-reviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Only the first job was processed before the deadline cutoff stopped claiming
    expect(calls).toBe(1);
    expect(data.processed).toBe(1);
    expect(data.jobs).toEqual(["job-fast"]);
  });

  describe("Group C - Hardening Tests (HMAC, Error Leak, Delivery Cleanup)", () => {
    it("verifyCronSecret HMAC comparison rejects token of different length without timing leaks", async () => {
      // Shorter token
      const reqShort = new Request("http://localhost/api/cron/process-reviews", {
        method: "POST",
        headers: { Authorization: "Bearer short" },
      });
      const resShort = await POST(reqShort);
      expect(resShort.status).toBe(401);

      // Longer token
      const reqLong = new Request("http://localhost/api/cron/process-reviews", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_SECRET}-extra-long-suffix` },
      });
      const resLong = await POST(reqLong);
      expect(resLong.status).toBe(401);

      // Same length wrong token
      const wrongSameLen = "x".repeat(TEST_SECRET.length);
      const reqSameLen = new Request("http://localhost/api/cron/process-reviews", {
        method: "POST",
        headers: { Authorization: `Bearer ${wrongSameLen}` },
      });
      const resSameLen = await POST(reqSameLen);
      expect(resSameLen.status).toBe(401);
    });

    it("returns generic { error: 'internal' } on unhandled error and never leaks error.message", async () => {
      vi.spyOn(processor, "processReview").mockRejectedValue(new Error("Sensitive internal DB stack trace"));

      mockDb.review_jobs.push({
        id: "job-crash",
        status: "pending",
        retry_count: 0,
        created_at: new Date().toISOString(),
      });

      // Force claim_review_jobs to throw an unhandled internal error
      vi.spyOn(mockSupabase, "rpc").mockImplementation(async (fn: string) => {
        if (fn === "claim_review_jobs") {
          throw new Error("Internal secret postgres connection string: postgres://user:pass@host/db");
        }
        return { data: null, error: null };
      });

      const req = new Request("http://localhost/api/cron/process-reviews", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: "internal" });
      expect(body.message).toBeUndefined();
    });

    it("cleanupOldWebhookDeliveries deletes unreferenced old deliveries and keeps referenced and recent deliveries", async () => {
      const now = Date.now();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

      // deliv-unreferenced-old: > 7 days old, NOT referenced by any job -> deleted
      // deliv-referenced-old: > 7 days old, referenced by a job -> kept
      // deliv-recent: < 7 days old -> kept
      mockDb.webhook_deliveries = [
        { delivery_id: "deliv-unreferenced-old", received_at: tenDaysAgo },
        { delivery_id: "deliv-referenced-old", received_at: tenDaysAgo },
        { delivery_id: "deliv-recent", received_at: twoDaysAgo },
      ];

      mockDb.review_jobs = [
        {
          id: "job-ref-old",
          delivery_id: "deliv-referenced-old",
          status: "completed",
          retry_count: 0,
          created_at: tenDaysAgo,
        },
      ];

      const deletedCount = await cleanupOldWebhookDeliveries(mockSupabase as any, 7);

      expect(deletedCount).toBe(1);
      expect(mockDb.webhook_deliveries.length).toBe(2);
      const remainingIds = mockDb.webhook_deliveries.map((d) => d.delivery_id);
      expect(remainingIds).toContain("deliv-referenced-old");
      expect(remainingIds).toContain("deliv-recent");
      expect(remainingIds).not.toContain("deliv-unreferenced-old");
    });

    it("cron route still processes jobs when cleanup throws an error", async () => {
      vi.spyOn(mockSupabase, "rpc").mockImplementation(async (fn: string, params?: any) => {
        if (fn === "cleanup_old_webhook_deliveries") {
          return { data: null, error: new Error("RPC cleanup failed") as any };
        }
        if (fn === "claim_review_jobs") {
          return {
            data: [
              {
                id: "job-cleanup-fail-1",
                repo_id: "repo-1",
                pr_number: 10,
                pr_title: "Cleanup resilient PR",
                pr_author: "author1",
                head_sha: "head1",
                base_sha: "base1",
                delivery_id: "deliv-1",
                status: "processing",
                retry_count: 0,
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const req = new Request("http://localhost:3000/api/cron/process-reviews", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.processed).toBe(1);
      expect(body.jobs).toHaveLength(1);
    });

    it("returns 429 with Retry-After when cron rate limit is exceeded", async () => {
      const rateLimitMod = await import("@/lib/rate-limit");
      vi.spyOn(rateLimitMod, "checkCronRateLimit").mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
        retryAfter: 60,
      });

      const req = new Request("http://localhost:3000/api/cron/process-reviews", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });

      const res = await POST(req);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
      const body = await res.json();
      expect(body).toEqual({
        error: "rate_limited",
        message: "Too many requests. Please try again later.",
        status: 429,
      });
    });
  });
});

// Live integration test: parallel claims on real database using exact IDs
describe("Live parallel claims integration (Supabase RPC)", () => {
  function getLiveConfig() {
    const envPath = path.resolve(process.cwd(), ".env.local");
    let fileEnv: Record<string, string> = {};

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

  it.skipIf(!canRunLive)(
    "parallel claims never return the same job (FOR UPDATE SKIP LOCKED)",
    async () => {
      const client1: SupabaseClient = createClient(supabaseUrl!, serviceKey!, {
        auth: { persistSession: false },
      });
      const client2: SupabaseClient = createClient(supabaseUrl!, serviceKey!, {
        auth: { persistSession: false },
      });

      const testInstId = "00000000-0000-0000-0000-000000000101";
      const testRepoId = "00000000-0000-0000-0000-000000000102";
      const testDeliv1 = "task10-test-delivery-1";
      const testDeliv2 = "task10-test-delivery-2";
      const testJob1 = "00000000-0000-0000-0000-000000000103";
      const testJob2 = "00000000-0000-0000-0000-000000000104";

      // Lookup real profile to associate test installation
      const { data: profiles } = await client1
        .from("profiles")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1);
      expect(profiles && profiles.length > 0).toBe(true);
      const profileId = profiles![0].id;

      try {
        // Seed test data with exact IDs
        await client1.from("installations").insert({
          id: testInstId,
          installation_id: 9999101,
          owner_id: profileId,
          account_login: "test-login",
          account_type: "User",
        });

        await client1.from("repos").insert({
          id: testRepoId,
          installation_id: testInstId,
          github_repo_id: 9999102,
          owner: "test-org",
          name: "test-repo",
          full_name: "test-org/test-repo",
          is_active: true,
        });

        await client1.from("webhook_deliveries").insert([
          { delivery_id: testDeliv1, event: "pull_request", action: "opened" },
          { delivery_id: testDeliv2, event: "pull_request", action: "opened" },
        ]);

        await client1.from("review_jobs").insert([
          {
            id: testJob1,
            repo_id: testRepoId,
            pr_number: 1,
            pr_title: "PR 1",
            pr_author: "author1",
            head_sha: "sha1",
            base_sha: "base1",
            delivery_id: testDeliv1,
            status: "pending",
          },
          {
            id: testJob2,
            repo_id: testRepoId,
            pr_number: 2,
            pr_title: "PR 2",
            pr_author: "author2",
            head_sha: "sha2",
            base_sha: "base2",
            delivery_id: testDeliv2,
            status: "pending",
          },
        ]);

        // Execute parallel claims simultaneously
        const [claim1, claim2] = await Promise.all([
          client1.rpc("claim_review_jobs", {
            claim_limit: 1,
            stale_seconds: 180,
            include_deferred: false,
            max_retries: 5,
          }),
          client2.rpc("claim_review_jobs", {
            claim_limit: 1,
            stale_seconds: 180,
            include_deferred: false,
            max_retries: 5,
          }),
        ]);

        expect(claim1.error).toBeNull();
        expect(claim2.error).toBeNull();

        const claimed1Ids = (claim1.data || []).map((j: any) => j.id);
        const claimed2Ids = (claim2.data || []).map((j: any) => j.id);

        // Disjoint sets: parallel claims must never claim the same job
        const overlap = claimed1Ids.filter((id: string) => claimed2Ids.includes(id));
        expect(overlap).toHaveLength(0);
      } finally {
        // Clean up only exact IDs created
        await client1.from("review_jobs").delete().eq("id", testJob1);
        await client1.from("review_jobs").delete().eq("id", testJob2);
        await client1.from("webhook_deliveries").delete().eq("delivery_id", testDeliv1);
        await client1.from("webhook_deliveries").delete().eq("delivery_id", testDeliv2);
        await client1.from("repos").delete().eq("id", testRepoId);
        await client1.from("installations").delete().eq("id", testInstId);

        // Verify user profile still exists
        const { data: postProfile } = await client1
          .from("profiles")
          .select("id")
          .eq("id", profileId)
          .single();
        expect(postProfile).toBeTruthy();
      }
    },
    30000
  );
});
