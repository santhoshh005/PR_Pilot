import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sign } from "@octokit/webhooks-methods";

const TEST_SECRET = "mock-webhook-secret-xyz";
process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({
  insert: mockInsert,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

describe("POST /api/webhook (Signature & Idempotency)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
  });

  it("rejects request with 401 when X-Hub-Signature-256 is missing", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ action: "opened" });
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

  it("rejects request with 401 when signature is invalid", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ action: "opened" });
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

  it("rejects request with 401 when body has been tampered with", async () => {
    const { POST } = await import("./route");
    const validBody = JSON.stringify({ action: "opened" });
    const signature = await sign(TEST_SECRET, validBody);
    const tamperedBody = JSON.stringify({ action: "opened", tampered: true });

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
    const body = JSON.stringify({ action: "opened" });
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
    const body = JSON.stringify({ action: "opened" });
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
    // Generate a payload exceeding the 5MB limit
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

  it("returns 200 { ignored: true } for valid non-pull_request events and stores delivery ID", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

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

    expect(mockFrom).toHaveBeenCalledWith("webhook_deliveries");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: "delivery-ping-1",
        event: "ping",
      })
    );
  });

  it("returns 200 { ok: true } for valid pull_request event and stores delivery ID", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    const { POST } = await import("./route");
    const body = JSON.stringify({ action: "opened", pull_request: { number: 10 } });
    const signature = await sign(TEST_SECRET, body);

    const req = new NextRequest("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-delivery": "delivery-pr-1",
        "x-github-event": "pull_request",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(mockFrom).toHaveBeenCalledWith("webhook_deliveries");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: "delivery-pr-1",
        event: "pull_request",
        action: "opened",
      })
    );
  });

  it("returns 200 { duplicate: true } when delivery ID is already recorded (idempotency)", async () => {
    mockInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const { POST } = await import("./route");
    const body = JSON.stringify({ action: "synchronize", pull_request: { number: 10 } });
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
  });
});
