import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifyWebhookSignature } from "@/lib/github/webhooks";
import { processReview } from "@/lib/review/processor";
import { createServiceClient } from "@/lib/supabase/service";
import { checkWebhookRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { WebhookPullRequestSchema } from "@/types";
import type { ApiError } from "@/types";

export const maxDuration = 300;

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB limit
const HANDLED_PR_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

export async function POST(request: Request) {
  try {
    const rateLimit = await checkWebhookRateLimit(request);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfter);
    }

    // Check Content-Length header if present to fail fast on oversized requests
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      const errorResponse: ApiError = {
        error: "payload_too_large",
        message: "Payload exceeds size limit",
        status: 413,
      };
      return NextResponse.json(errorResponse, { status: 413 });
    }

    // Read the raw body as text for HMAC verification
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      const errorResponse: ApiError = {
        error: "payload_too_large",
        message: "Payload exceeds size limit",
        status: 413,
      };
      return NextResponse.json(errorResponse, { status: 413 });
    }

    const signature = request.headers.get("x-hub-signature-256");
    const deliveryId = request.headers.get("x-github-delivery");
    const event = request.headers.get("x-github-event");

    // Validate signature first: reject bad signatures with 401 and no details
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const isValid = await verifyWebhookSignature(rawBody, signature, secret);

    if (!isValid) {
      const errorResponse: ApiError = {
        error: "unauthorized",
        message: "Invalid signature",
        status: 401,
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    // Check required GitHub headers
    if (!deliveryId || !event) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: "Missing required headers",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Parse JSON payload (never log the payload)
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      if (event === "pull_request") {
        const errorResponse: ApiError = {
          error: "bad_request",
          message: "Invalid JSON payload",
          status: 400,
        };
        return NextResponse.json(errorResponse, { status: 400 });
      }
    }

    const action =
      parsedBody && typeof parsedBody.action === "string"
        ? parsedBody.action
        : "";

    // SERVICE_ROLE: deduplicate webhook deliveries by inserting delivery ID
    const serviceClient = createServiceClient();
    const { error: insertError } = await serviceClient
      .from("webhook_deliveries")
      .insert({
        delivery_id: deliveryId,
        event,
        action,
      });

    if (insertError) {
      // Postgres unique constraint violation code is 23505
      if (
        insertError.code === "23505" ||
        insertError.message?.toLowerCase().includes("duplicate")
      ) {
        return NextResponse.json({ duplicate: true }, { status: 200 });
      }

      console.error(`[WEBHOOK] Failed to record delivery for ${deliveryId}`);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to process webhook delivery",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Non-pull_request events return 200 { ignored: true }
    if (event !== "pull_request") {
      return NextResponse.json({ ignored: true }, { status: 200 });
    }

    // Ignore unhandled PR actions (e.g. closed, labeled, edited)
    if (!HANDLED_PR_ACTIONS.has(action)) {
      return NextResponse.json({ ignored: true }, { status: 200 });
    }

    // Validate pull_request payload schema
    const parseResult = WebhookPullRequestSchema.safeParse(parsedBody);
    if (!parseResult.success) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: "Invalid pull_request payload schema",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const prPayload = parseResult.data;

    // SERVICE_ROLE: find repo in database to link review job and check if active
    const { data: repo, error: repoError } = await serviceClient
      .from("repos")
      .select("id, is_active")
      .eq("github_repo_id", prPayload.repository.id)
      .single();

    if (repoError || !repo) {
      // Repo may not be synced yet - return 200 to prevent GitHub endless retries
      return NextResponse.json(
        { ignored: true, reason: "repo_not_found" },
        { status: 200 }
      );
    }

    if (!repo.is_active) {
      return NextResponse.json(
        { ignored: true, reason: "repo_inactive" },
        { status: 200 }
      );
    }

    // SERVICE_ROLE: enqueue review job with status 'pending'
    const { data: job, error: jobError } = await serviceClient
      .from("review_jobs")
      .insert({
        repo_id: repo.id,
        pr_number: prPayload.number,
        pr_title: prPayload.pull_request.title,
        pr_author: prPayload.pull_request.user.login,
        head_sha: prPayload.pull_request.head.sha,
        base_sha: prPayload.pull_request.base.sha,
        delivery_id: deliveryId,
        status: "pending",
      })
      .select("id")
      .single();

    if (jobError || !job) {
      console.error(`[WEBHOOK] Failed to enqueue review job for delivery ${deliveryId}`);
      // Clean up delivery row so GitHub automatic redelivery is not falsely rejected as duplicate
      await serviceClient
        .from("webhook_deliveries")
        .delete()
        .eq("delivery_id", deliveryId);

      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to create review job",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Trigger asynchronous review processing without blocking the response
    waitUntil(
      (async () => {
        try {
          await processReview(job.id);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("Background review processing error:", msg);
        }
      })()
    );

    return NextResponse.json({ ok: true, job_id: job.id }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("Webhook processing error:", message);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Internal server error",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
