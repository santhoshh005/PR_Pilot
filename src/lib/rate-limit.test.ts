import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServiceClient } from "./supabase/service";
import {
  getClientIp,
  hashKey,
  checkRateLimit,
  rateLimitResponse,
  checkRateLimitInMemory,
  resetInMemoryRateLimits,
  RATE_LIMITS,
  checkWebhookRateLimit,
  checkDashboardRateLimit,
  checkCronRateLimit,
  checkAuthRateLimit,
} from "./rate-limit";

describe("Rate Limiting Utilities", () => {
  describe("getClientIp", () => {
    it("extracts the first IP from x-forwarded-for header", () => {
      const req = new Request("http://localhost:3000", {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178" },
      });
      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("falls back to x-real-ip if x-forwarded-for is missing", () => {
      const req = new Request("http://localhost:3000", {
        headers: { "x-real-ip": "198.51.100.22" },
      });
      expect(getClientIp(req)).toBe("198.51.100.22");
    });

    it("falls back to 127.0.0.1 if no IP headers are present", () => {
      const req = new Request("http://localhost:3000");
      expect(getClientIp(req)).toBe("127.0.0.1");
    });
  });

  describe("hashKey", () => {
    it("creates a hashed key with prefix without revealing sensitive input", () => {
      const rawIp = "192.168.1.100";
      const key1 = hashKey("webhook", rawIp);
      expect(key1).toMatch(/^webhook:[a-f0-9]{32}$/);
      expect(key1).not.toContain(rawIp);

      const key2 = hashKey("webhook", rawIp);
      expect(key1).toBe(key2); // deterministic

      const key3 = hashKey("webhook", "192.168.1.101");
      expect(key1).not.toBe(key3); // isolates distinct identifiers
    });
  });

  describe("rateLimitResponse", () => {
    it("returns 429 status with Retry-After header and generic ApiError body", async () => {
      const res = rateLimitResponse(45);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("45");

      const body = await res.json();
      expect(body).toEqual({
        error: "rate_limited",
        message: "Too many requests. Please try again later.",
        status: 429,
      });
      // Ensure no internal DB leaks
      expect(JSON.stringify(body)).not.toContain("database");
      expect(JSON.stringify(body)).not.toContain("rate_limits");
    });

    it("ensures Retry-After is at least 1 second", () => {
      const res = rateLimitResponse(0);
      expect(res.headers.get("Retry-After")).toBe("1");
    });
  });

  describe("checkRateLimit (Postgres RPC backed)", () => {
    it("allows request when under the limit", async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ allowed: true, remaining: 59, reset_at: "2026-10-20T22:00:00Z", retry_after: 0 }],
          error: null,
        }),
      };

      const result = await checkRateLimit("test-key", 60, 60, { client: mockClient as unknown as ReturnType<typeof createServiceClient> });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59);
      expect(result.retryAfter).toBe(0);
      expect(mockClient.rpc).toHaveBeenCalledWith("check_rate_limit", {
        p_key: "test-key",
        p_limit: 60,
        p_window_seconds: 60,
      });
    });

    it("blocks request when over the limit with retryAfter value", async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ allowed: false, remaining: 0, reset_at: "2026-10-20T22:00:30Z", retry_after: 30 }],
          error: null,
        }),
      };

      const result = await checkRateLimit("test-key", 60, 60, { client: mockClient as unknown as ReturnType<typeof createServiceClient> });
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(30);
    });

    it("fails open when database call encounters an error (default failOpen: true)", async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Database connection timeout" },
        }),
      };

      const result = await checkRateLimit("test-key", 60, 60, { client: mockClient as unknown as ReturnType<typeof createServiceClient> });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
      expect(result.retryAfter).toBe(0);
    });

    it("fails closed when failOpen is explicitly set to false", async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Database connection timeout" },
        }),
      };

      const result = await checkRateLimit("test-key", 60, 60, { client: mockClient as unknown as ReturnType<typeof createServiceClient>, failOpen: false });
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(60);
    });
  });

  describe("checkRateLimitInMemory (Sliding Window)", () => {
    beforeEach(() => {
      resetInMemoryRateLimits();
    });

    it("allows requests under the limit", () => {
      const res1 = checkRateLimitInMemory("mem-key-1", 3, 60);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);

      const res2 = checkRateLimitInMemory("mem-key-1", 3, 60);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);

      const res3 = checkRateLimitInMemory("mem-key-1", 3, 60);
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);
    });

    it("blocks requests over the limit", () => {
      for (let i = 0; i < 3; i++) {
        checkRateLimitInMemory("mem-key-2", 3, 60);
      }
      const overLimitRes = checkRateLimitInMemory("mem-key-2", 3, 60);
      expect(overLimitRes.allowed).toBe(false);
      expect(overLimitRes.remaining).toBe(0);
      expect(overLimitRes.retryAfter).toBeGreaterThan(0);
    });

    it("resets after window expires", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      checkRateLimitInMemory("mem-key-3", 1, 10);
      const blocked = checkRateLimitInMemory("mem-key-3", 1, 10);
      expect(blocked.allowed).toBe(false);

      // Advance time by 11 seconds (past window)
      vi.spyOn(Date, "now").mockReturnValue(now + 11000);

      const afterReset = checkRateLimitInMemory("mem-key-3", 1, 10);
      expect(afterReset.allowed).toBe(true);
      expect(afterReset.remaining).toBe(0);

      vi.restoreAllMocks();
    });

    it("isolates limits across different keys", () => {
      checkRateLimitInMemory("user-1", 1, 60);
      const blockedUser1 = checkRateLimitInMemory("user-1", 1, 60);
      expect(blockedUser1.allowed).toBe(false);

      const allowedUser2 = checkRateLimitInMemory("user-2", 1, 60);
      expect(allowedUser2.allowed).toBe(true);
    });
  });

  describe("Endpoint Helpers and Configured Limits", () => {
    it("configures limits matching PLAN.md", () => {
      expect(RATE_LIMITS.WEBHOOK).toEqual({ limit: 60, windowSeconds: 60 });
      expect(RATE_LIMITS.DASHBOARD).toEqual({ limit: 30, windowSeconds: 60 });
      expect(RATE_LIMITS.CRON).toEqual({ limit: 1, windowSeconds: 60 });
      expect(RATE_LIMITS.AUTH).toEqual({ limit: 10, windowSeconds: 60 });
    });

    it("checkWebhookRateLimit hashes client IP and uses 60/min", async () => {
      const req = new Request("http://localhost:3000/api/webhook", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ allowed: true, remaining: 59, reset_at: "2026-10-20T22:00:00Z", retry_after: 0 }],
          error: null,
        }),
      };

      await checkWebhookRateLimit(req, mockClient as unknown as ReturnType<typeof createServiceClient>);
      expect(mockClient.rpc).toHaveBeenCalledWith("check_rate_limit", {
        p_key: expect.stringMatching(/^webhook:[a-f0-9]{32}$/),
        p_limit: 60,
        p_window_seconds: 60,
      });
    });

    it("checkDashboardRateLimit hashes userId and uses 30/min", async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ allowed: true, remaining: 29, reset_at: "2026-10-20T22:00:00Z", retry_after: 0 }],
          error: null,
        }),
      };

      await checkDashboardRateLimit("user-uuid-123", mockClient as unknown as ReturnType<typeof createServiceClient>);
      expect(mockClient.rpc).toHaveBeenCalledWith("check_rate_limit", {
        p_key: expect.stringMatching(/^dashboard:[a-f0-9]{32}$/),
        p_limit: 30,
        p_window_seconds: 60,
      });
    });

    it("checkCronRateLimit hashes client IP and uses 1/min", async () => {
      const req = new Request("http://localhost:3000/api/cron/process-reviews", {
        headers: { "x-forwarded-for": "5.6.7.8" },
      });
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ allowed: true, remaining: 0, reset_at: "2026-10-20T22:00:00Z", retry_after: 0 }],
          error: null,
        }),
      };

      await checkCronRateLimit(req, mockClient as unknown as ReturnType<typeof createServiceClient>);
      expect(mockClient.rpc).toHaveBeenCalledWith("check_rate_limit", {
        p_key: expect.stringMatching(/^cron:[a-f0-9]{32}$/),
        p_limit: 1,
        p_window_seconds: 60,
      });
    });

    it("checkAuthRateLimit hashes client IP and uses 10/min", async () => {
      const req = new Request("http://localhost:3000/api/auth/callback", {
        headers: { "x-forwarded-for": "9.10.11.12" },
      });
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ allowed: true, remaining: 9, reset_at: "2026-10-20T22:00:00Z", retry_after: 0 }],
          error: null,
        }),
      };

      await checkAuthRateLimit(req, mockClient as unknown as ReturnType<typeof createServiceClient>);
      expect(mockClient.rpc).toHaveBeenCalledWith("check_rate_limit", {
        p_key: expect.stringMatching(/^auth:[a-f0-9]{32}$/),
        p_limit: 10,
        p_window_seconds: 60,
      });
    });
  });
});
