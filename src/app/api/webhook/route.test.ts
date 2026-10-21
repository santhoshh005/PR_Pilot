import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sign } from "@octokit/webhooks-methods";
import { resetInMemoryRateLimits } from "@/lib/rate-limit";

const TEST_SECRET = "mock-webhook-secret-xyz";
process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;

const mockWaitUntil = vi.fn();
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    mockWaitUntil(p);
    return p;
  },
}));

const mockProcessReview = vi.fn((id?: string) => {
  void id;
  return Promise.resolve();
});
vi.mock("@/lib/review/processor", () => ({
  processReview: (id: string) => mockProcessReview(id),
}));

// Supabase mocking
const mockWebhookDeliveriesInsert = vi.fn();
const mockWebhookDeliveriesDelete = vi.fn();
const mockWebhookDeliveriesEq = vi.fn();

const mockReposSelect = vi.fn();
const mockReposEq = vi.fn();
const mockReposSingle = vi.fn();

const mockReviewJobsInsert = vi.fn();
const mockReviewJobsSelect = vi.fn();
const mockReviewJobsSingle = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === "webhook_deliveries") {
    return {
      insert: mockWebhookDeliveriesInsert,
      delete: mockWebhookDeliveriesDelete.mockReturnValue({
        eq: mockWebhookDeliveriesEq,
      }),
    };
  }
  if (table === "repos") {
    return {
      select: mockReposSelect.mockReturnValue({
        eq: mockReposEq.mockReturnValue({
          single: mockReposSingle,
        }),
      }),
    };
  }
  if (table === "review_jobs") {
    return {
      insert: mockReviewJobsInsert.mockReturnValue({
        select: mockReviewJobsSelect.mockReturnValue({
          single: mockReviewJobsSingle,
        }),
      }),
    };
  }
  return {};
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
    rpc: vi.fn().mockResolvedValue({
      data: [{ allowed: true, remaining: 59, reset_at: "2026-10-20T22:00:00Z", retry_after: 0 }],
      error: null,
    }),
  })),
}));

const validPrPayload = {
  action: "opened",
  number: 101,
  pull_request: {
    title: "Refactor auth pipeline",
    user: {
      login: "developer1",
    },
    head: {
      sha: "head-sha-123456",
    },
    base: {
      sha: "base-sha-abcdef",
    },
    state: "open",
  },
  repository: {
    id: 987654321,
    full_name: "acme/backend",
  },
  installation: {
    id: 112233,
  },
};

describe("POST /api/webhook", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryRateLimits();
    process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
  });

  // --- Signature & Size limits ---

  it("rejects request with 401 when X-Hub-Signature-256 is missing", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-1",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.status).toBe(401);
    expect(json.error).toBe("unauthorized");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does not invoke Postgres rate limiting when signature is invalid or missing", async () => {
    const rateLimitMod = await import("@/lib/rate-limit");
    const checkWebhookRateLimitSpy = vi.spyOn(rateLimitMod, "checkWebhookRateLimit");

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-bad-sig",
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=forged-bad-signature",
      },
      body: JSON.stringify(validPrPayload),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(checkWebhookRateLimitSpy).not.toHaveBeenCalled();
    checkWebhookRateLimitSpy.mockRestore();
  });

  it("rejects request with 401 when signature is invalid", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "sha256=invalid-signature",
        "x-github-delivery": "delivery-2",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.status).toBe(401);
    expect(json.error).toBe("unauthorized");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does not invoke Postgres rate limiting when signature is invalid or missing", async () => {
    const rateLimitMod = await import("@/lib/rate-limit");
    const checkWebhookRateLimitSpy = vi.spyOn(rateLimitMod, "checkWebhookRateLimit");

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-bad-sig",
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=forged-bad-signature",
      },
      body: JSON.stringify(validPrPayload),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(checkWebhookRateLimitSpy).not.toHaveBeenCalled();
    checkWebhookRateLimitSpy.mockRestore();
  });

  it("rejects request with 401 when body has been tampered with", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);
    const tamperedBody = JSON.stringify({ ...validPrPayload, action: "closed" });

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-3",
        "x-github-event": "pull_request",
      },
      body: tamperedBody,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects request with 400 when X-GitHub-Delivery header is missing", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.status).toBe(400);
    expect(json.error).toBe("bad_request");
  });

  it("rejects request with 400 when X-GitHub-Event header is missing", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-4",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.status).toBe(400);
    expect(json.error).toBe("bad_request");
  });

  it("rejects oversized request body with 413", async () => {
    const { POST } = await import("./route");
    const hugePayload = "x".repeat(5 * 1024 * 1024 + 10);
    const signature = await sign(TEST_SECRET, hugePayload);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-huge",
        "x-github-event": "pull_request",
      },
      body: hugePayload,
    });

    const res = await POST(req);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.status).toBe(413);
    expect(json.error).toBe("payload_too_large");
  });

  // --- Idempotency Deduplication ---

  it("returns 200 { duplicate: true } when delivery ID is already recorded", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-duplicate-1",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicate).toBe(true);
    // Should NOT query repos or insert review jobs
    expect(mockReposSelect).not.toHaveBeenCalled();
    expect(mockReviewJobsInsert).not.toHaveBeenCalled();
  });

  // --- Ignored Cases ---

  it("returns 200 { ignored: true } for non-pull_request events", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });

    const { POST } = await import("./route");
    const body = JSON.stringify({ zen: "Design for failure." });
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-ping-1",
        "x-github-event": "ping",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(mockWebhookDeliveriesInsert).toHaveBeenCalled();
    expect(mockReposSelect).not.toHaveBeenCalled();
  });

  it("returns 200 { ignored: true } for unhandled pull_request actions (e.g. closed, labeled)", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });

    const { POST } = await import("./route");
    const body = JSON.stringify({
      ...validPrPayload,
      action: "closed",
    });
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-closed-1",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(mockReposSelect).not.toHaveBeenCalled();
  });

  it("returns 200 { ignored: true, reason: 'repo_not_found' } when repo is not in database", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });
    // Repo query returns not found
    mockReposSingle.mockResolvedValueOnce({ data: null, error: new Error("Row not found") });

    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-unknown-repo",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("repo_not_found");
    expect(mockReviewJobsInsert).not.toHaveBeenCalled();
  });

  it("returns 200 { ignored: true, reason: 'repo_inactive' } when repo is deactivated", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });
    mockReposSingle.mockResolvedValueOnce({
      data: { id: "repo-uuid-inactive", is_active: false },
      error: null,
    });

    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-inactive-repo",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("repo_inactive");
    expect(mockReviewJobsInsert).not.toHaveBeenCalled();
  });

  // --- Invalid Payload Cases ---

  it("returns 400 without leaking details when pull_request payload schema validation fails", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });

    const { POST } = await import("./route");
    const malformedPayload = {
      action: "opened",
      number: 101,
      pull_request: {
        title: "Missing SHA",
        user: { login: "dev" },
      },
      repository: { id: 123 },
    };
    const body = JSON.stringify(malformedPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-malformed-1",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad_request");
    // Ensure no sensitive internal stack traces or raw schema dumps leak
    expect(json.message).toBe("Invalid pull_request payload schema");
  });

  // --- Enqueue Success Cases ---

  it("enqueues a review job for valid opened pull_request, calls waitUntil, and returns 200 { ok: true, job_id }", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });
    mockReposSingle.mockResolvedValueOnce({
      data: { id: "repo-uuid-99", is_active: true },
      error: null,
    });
    mockReviewJobsSingle.mockResolvedValueOnce({
      data: { id: "job-uuid-777" },
      error: null,
    });

    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-enqueue-1",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.job_id).toBe("job-uuid-777");

    expect(mockFrom).toHaveBeenCalledWith("review_jobs");
    expect(mockReviewJobsInsert).toHaveBeenCalledWith({
      repo_id: "repo-uuid-99",
      pr_number: 101,
      pr_title: "Refactor auth pipeline",
      pr_author: "developer1",
      head_sha: "head-sha-123456",
      base_sha: "base-sha-abcdef",
      delivery_id: "delivery-enqueue-1",
      status: "pending",
    });

    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  });

  it("enqueues job for synchronize and reopened actions", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });
    mockReposSingle.mockResolvedValueOnce({
      data: { id: "repo-uuid-99", is_active: true },
      error: null,
    });
    mockReviewJobsSingle.mockResolvedValueOnce({
      data: { id: "job-uuid-888" },
      error: null,
    });

    const { POST } = await import("./route");
    const body = JSON.stringify({ ...validPrPayload, action: "synchronize" });
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-sync-1",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.job_id).toBe("job-uuid-888");
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  });

  // --- Idempotency Fix: Job Creation Failure Recovery ---

  it("removes delivery row when review job creation fails, allowing automatic redelivery to succeed", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);
    const deliveryId = "delivery-fail-retry-1";

    // Attempt 1: Job creation in DB fails (e.g. database glitch)
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });
    mockReposSingle.mockResolvedValueOnce({
      data: { id: "repo-uuid-99", is_active: true },
      error: null,
    });
    mockReviewJobsSingle.mockResolvedValueOnce({
      data: null,
      error: new Error("DB connection timeout"),
    });
    mockWebhookDeliveriesEq.mockResolvedValueOnce({ error: null });

    const req1 = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": deliveryId,
        "x-github-event": "pull_request",
      },
      body,
    });

    const res1 = await POST(req1);
    expect(res1.status).toBe(500);

    // Verify delivery row was removed
    expect(mockWebhookDeliveriesDelete).toHaveBeenCalledTimes(1);
    expect(mockWebhookDeliveriesEq).toHaveBeenCalledWith("delivery_id", deliveryId);

    // Attempt 2: GitHub automatic redelivery with the SAME deliveryId
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });
    mockReposSingle.mockResolvedValueOnce({
      data: { id: "repo-uuid-99", is_active: true },
      error: null,
    });
    mockReviewJobsSingle.mockResolvedValueOnce({
      data: { id: "job-uuid-recovered" },
      error: null,
    });

    const req2 = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": deliveryId,
        "x-github-event": "pull_request",
      },
      body,
    });

    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.ok).toBe(true);
    expect(json2.job_id).toBe("job-uuid-recovered");
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  });

  // --- Background Error Resilience ---

  it("handles background review processor error inside waitUntil without crashing or hanging the response", async () => {
    mockWebhookDeliveriesInsert.mockResolvedValueOnce({ error: null });
    mockReposSingle.mockResolvedValueOnce({
      data: { id: "repo-uuid-99", is_active: true },
      error: null,
    });
    mockReviewJobsSingle.mockResolvedValueOnce({
      data: { id: "job-uuid-bg-err" },
      error: null,
    });
    // Background processor rejects with an error
    mockProcessReview.mockRejectedValueOnce(new Error("AI quota exhausted in background"));

    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-bg-fail",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.job_id).toBe("job-uuid-bg-err");
  });

  // --- Rate Limiting Enforcement ---

  it("returns 429 with Retry-After when rate limit is exceeded", async () => {
    const rateLimitMod = await import("@/lib/rate-limit");
    vi.spyOn(rateLimitMod, "checkWebhookRateLimit").mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 45000),
      retryAfter: 45,
    });

    const { POST } = await import("./route");
    const body = JSON.stringify(validPrPayload);
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-rate-limited",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
    const json = await res.json();
    expect(json).toEqual({
      error: "rate_limited",
      message: "Too many requests. Please try again later.",
      status: 429,
    });
  });
});
