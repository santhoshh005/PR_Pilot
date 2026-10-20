import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ApiError } from "@/types";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter: number;
}

export const RATE_LIMITS = {
  WEBHOOK: { limit: 60, windowSeconds: 60 },
  DASHBOARD: { limit: 30, windowSeconds: 60 },
  CRON: { limit: 1, windowSeconds: 60 },
  AUTH: { limit: 10, windowSeconds: 60 },
} as const;

/**
 * Extracts the client IP from standard proxy headers, falling back safely.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const clientIp = forwarded.split(",")[0]?.trim();
    if (clientIp) return clientIp;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }
  return "127.0.0.1";
}

/**
 * Produces a hashed key with a domain prefix to prevent storing raw IPs or secrets.
 */
export function hashKey(prefix: string, identifier: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(identifier)
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${hash}`;
}

/**
 * Constructs a standard 429 response matching ApiError shape with Retry-After header.
 */
export function rateLimitResponse(retryAfter: number): NextResponse {
  const error: ApiError = {
    error: "rate_limited",
    message: "Too many requests. Please try again later.",
    status: 429,
  };

  return NextResponse.json(error, {
    status: 429,
    headers: {
      "Retry-After": Math.max(1, Math.ceil(retryAfter)).toString(),
    },
  });
}

export interface CheckRateLimitOptions {
  client?: ReturnType<typeof createServiceClient>;
  failOpen?: boolean;
}

/**
 * Primary Postgres-backed rate limiter using atomic RPC `check_rate_limit`.
 * Falls back according to failOpen policy (default true for serverless availability).
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: CheckRateLimitOptions = {}
): Promise<RateLimitResult> {
  const { client, failOpen = true } = options;

  try {
    const supabase = client ?? createServiceClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.warn("[RATE_LIMIT] Limiter RPC error:", error.message);
      if (failOpen) {
        return {
          allowed: true,
          remaining: 1,
          resetAt: new Date(Date.now() + windowSeconds * 1000),
          retryAfter: 0,
        };
      }
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
        retryAfter: windowSeconds,
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return {
        allowed: true,
        remaining: 1,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
        retryAfter: 0,
      };
    }

    return {
      allowed: Boolean(row.allowed),
      remaining: Math.max(0, Number(row.remaining)),
      resetAt: new Date(row.reset_at),
      retryAfter: Math.max(0, Number(row.retry_after)),
    };
  } catch (err: any) {
    console.warn("[RATE_LIMIT] Unexpected error during rate check:", err?.message || err);
    if (failOpen) {
      return {
        allowed: true,
        remaining: 1,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
        retryAfter: 0,
      };
    }
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + windowSeconds * 1000),
      retryAfter: windowSeconds,
    };
  }
}

// --- In-Memory Sliding Window Implementation (PLAN.md Task 13) ---

interface InMemoryEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, InMemoryEntry>();

/**
 * In-memory sliding window rate limiter with automatic expired entry cleanup.
 */
export function checkRateLimitInMemory(
  key: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // Cleanup expired entries periodically to prevent memory leaks
  for (const [storedKey, entry] of memoryStore.entries()) {
    if (entry.resetAt <= now) {
      memoryStore.delete(storedKey);
    }
  }

  const existing = memoryStore.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    memoryStore.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: new Date(resetAt),
      retryAfter: 0,
    };
  }

  if (existing.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(existing.resetAt),
      retryAfter,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: new Date(existing.resetAt),
    retryAfter: 0,
  };
}

export function resetInMemoryRateLimits(): void {
  memoryStore.clear();
}

// --- Endpoint-Specific Helpers ---

export async function checkWebhookRateLimit(
  request: Request,
  client?: ReturnType<typeof createServiceClient>
): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  const key = hashKey("webhook", ip);
  return checkRateLimit(key, RATE_LIMITS.WEBHOOK.limit, RATE_LIMITS.WEBHOOK.windowSeconds, {
    client,
    failOpen: true,
  });
}

export async function checkDashboardRateLimit(
  userId: string,
  client?: ReturnType<typeof createServiceClient>
): Promise<RateLimitResult> {
  const key = hashKey("dashboard", userId);
  return checkRateLimit(key, RATE_LIMITS.DASHBOARD.limit, RATE_LIMITS.DASHBOARD.windowSeconds, {
    client,
    failOpen: true,
  });
}

export async function checkCronRateLimit(
  request: Request,
  client?: ReturnType<typeof createServiceClient>
): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  const key = hashKey("cron", ip);
  return checkRateLimit(key, RATE_LIMITS.CRON.limit, RATE_LIMITS.CRON.windowSeconds, {
    client,
    failOpen: true,
  });
}

export async function checkAuthRateLimit(
  request: Request,
  client?: ReturnType<typeof createServiceClient>
): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  const key = hashKey("auth", ip);
  return checkRateLimit(key, RATE_LIMITS.AUTH.limit, RATE_LIMITS.AUTH.windowSeconds, {
    client,
    failOpen: true,
  });
}
