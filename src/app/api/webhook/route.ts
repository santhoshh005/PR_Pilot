import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/github/webhooks";
import { createServiceClient } from "@/lib/supabase/service";
import type { ApiError } from "@/types";

export const maxDuration = 300;

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB limit

export async function POST(request: Request) {
  try {
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

    // Parse action from payload if available (never log the payload)
    let action = "";
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed.action === "string") {
        action = parsed.action;
      }
    } catch {
      // Body may not be JSON for some ping events
    }

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

      console.error("Failed to record webhook delivery:", insertError.message);
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

    return NextResponse.json({ ok: true }, { status: 200 });
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
