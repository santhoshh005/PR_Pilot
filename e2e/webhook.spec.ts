import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import {
  getAdminClient,
  getSupabaseConfig,
  cleanupTestData,
  TrackedEntities,
} from "./helpers/test-fixtures";

test.describe("E2E - Webhook Delivery & Rate Limiting", () => {
  const adminClient = getAdminClient();
  const config = getSupabaseConfig();
  const tracked: TrackedEntities = {
    userIds: [],
    installationIds: [],
    repoIds: [],
    settingsIds: [],
    deliveryIds: [],
    jobIds: [],
    reviewIds: [],
    commentIds: [],
  };

  function computeHmac(body: string, secret: string): string {
    return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  }

  test.afterAll(async () => {
    await cleanupTestData(adminClient, tracked);
  });

  test("accepts valid HMAC signature and records delivery in database", async ({
    request,
  }) => {
    const deliveryId = `e2e-delivery-valid-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    tracked.deliveryIds.push(deliveryId);

    const payload = JSON.stringify({ zen: "Design for failure." });
    const signature = computeHmac(payload, config.webhookSecret);

    const res = await request.post("/api/webhook", {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": deliveryId,
        "x-github-event": "ping",
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ignored).toBe(true);

    // Verify delivery was recorded in live database
    const { data: deliveryRow } = await adminClient
      .from("webhook_deliveries")
      .select("delivery_id, event")
      .eq("delivery_id", deliveryId)
      .single();

    expect(deliveryRow?.delivery_id).toBe(deliveryId);
    expect(deliveryRow?.event).toBe("ping");
  });

  test("rejects invalid HMAC signature with 401 Unauthorized", async ({
    request,
  }) => {
    const deliveryId = `e2e-delivery-invalid-${Date.now()}`;
    const payload = JSON.stringify({ zen: "Fail fast." });
    const badSignature =
      "sha256=0000000000000000000000000000000000000000000000000000000000000000";

    const res = await request.post("/api/webhook", {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": badSignature,
        "x-github-delivery": deliveryId,
        "x-github-event": "ping",
      },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  test("rejects request without signature header with 401 Unauthorized", async ({
    request,
  }) => {
    const deliveryId = `e2e-delivery-nosig-${Date.now()}`;
    const payload = JSON.stringify({ zen: "No signature provided." });

    const res = await request.post("/api/webhook", {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "ping",
      },
    });

    expect(res.status()).toBe(401);
  });

  test("idempotently handles duplicate delivery ID with 200 and duplicate flag", async ({
    request,
  }) => {
    const deliveryId = `e2e-delivery-dup-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    tracked.deliveryIds.push(deliveryId);

    const payload = JSON.stringify({ zen: "Idempotency is king." });
    const signature = computeHmac(payload, config.webhookSecret);

    // 1. First delivery
    const res1 = await request.post("/api/webhook", {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": deliveryId,
        "x-github-event": "ping",
      },
    });
    expect(res1.status()).toBe(200);

    // 2. Exact same delivery ID redelivered
    const res2 = await request.post("/api/webhook", {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": deliveryId,
        "x-github-event": "ping",
      },
    });
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();
    expect(body2.duplicate).toBe(true);
  });

  test("enforces 429 rate limit with Retry-After header on repeated burst", async ({
    request,
  }) => {
    const testClientIp = `198.51.100.${Math.floor(10 + Math.random() * 80)}`;
    let hitRateLimit = false;
    let rateLimitRes = null;

    // Send rapid requests with unique delivery IDs until limit (60) is exceeded
    for (let i = 0; i < 65; i++) {
      const deliveryId = `e2e-burst-${Date.now()}-${i}`;
      tracked.deliveryIds.push(deliveryId);

      const payload = JSON.stringify({ burst: i });
      const signature = computeHmac(payload, config.webhookSecret);

      const res = await request.post("/api/webhook", {
        data: payload,
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-delivery": deliveryId,
          "x-github-event": "ping",
          "x-forwarded-for": testClientIp,
        },
      });

      if (res.status() === 429) {
        hitRateLimit = true;
        rateLimitRes = res;
        break;
      }
    }

    expect(hitRateLimit).toBe(true);
    expect(rateLimitRes?.status()).toBe(429);
    const retryAfter = rateLimitRes?.headers()["retry-after"];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);

    const body = await rateLimitRes?.json();
    expect(body.error).toBe("rate_limited");
  });
});
