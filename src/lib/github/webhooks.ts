import { verify } from "@octokit/webhooks-methods";

/**
 * Verifies a GitHub webhook signature using HMAC-SHA256 with constant-time comparison.
 *
 * @param body The raw webhook payload text.
 * @param signature The X-Hub-Signature-256 header value (e.g. "sha256=...").
 * @param secret The webhook secret configured for the GitHub App.
 * @returns true if the signature is valid, false otherwise.
 */
export async function verifyWebhookSignature(
  body: string,
  signature: string | null | undefined,
  secret: string | null | undefined
): Promise<boolean> {
  if (!signature || !secret || typeof body !== "string") {
    return false;
  }

  try {
    return await verify(secret, body, signature);
  } catch {
    return false;
  }
}
