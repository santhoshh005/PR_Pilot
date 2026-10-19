import { describe, it, expect } from "vitest";
import { sign } from "@octokit/webhooks-methods";

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret-12345";
  const payload = JSON.stringify({ action: "opened", number: 42 });

  it("returns true for a valid HMAC-SHA256 signature", async () => {
    const { verifyWebhookSignature } = await import("./webhooks");
    const signature = await sign(secret, payload);

    const isValid = await verifyWebhookSignature(payload, signature, secret);
    expect(isValid).toBe(true);
  });

  it("returns false for an invalid signature", async () => {
    const { verifyWebhookSignature } = await import("./webhooks");
    const badSignature = "sha256=0000000000000000000000000000000000000000000000000000000000000000";

    const isValid = await verifyWebhookSignature(payload, badSignature, secret);
    expect(isValid).toBe(false);
  });

  it("returns false if the body has been tampered with", async () => {
    const { verifyWebhookSignature } = await import("./webhooks");
    const signature = await sign(secret, payload);
    const tamperedPayload = JSON.stringify({ action: "opened", number: 999 });

    const isValid = await verifyWebhookSignature(tamperedPayload, signature, secret);
    expect(isValid).toBe(false);
  });

  it("returns false when signature header is missing or empty", async () => {
    const { verifyWebhookSignature } = await import("./webhooks");

    expect(await verifyWebhookSignature(payload, undefined, secret)).toBe(false);
    expect(await verifyWebhookSignature(payload, null, secret)).toBe(false);
    expect(await verifyWebhookSignature(payload, "", secret)).toBe(false);
  });

  it("returns false when secret is missing or empty", async () => {
    const { verifyWebhookSignature } = await import("./webhooks");
    const signature = await sign(secret, payload);

    expect(await verifyWebhookSignature(payload, signature, undefined)).toBe(false);
    expect(await verifyWebhookSignature(payload, signature, null)).toBe(false);
    expect(await verifyWebhookSignature(payload, signature, "")).toBe(false);
  });
});
