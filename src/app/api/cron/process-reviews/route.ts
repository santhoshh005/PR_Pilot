import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG, ReviewJob } from "@/types";
import { createServiceClient } from "@/lib/supabase/service";
import { processReview } from "@/lib/review/processor";

export const maxDuration = 300;

const INTERNAL_BUDGET_MS = 250_000;
const SAFETY_BUFFER_MS = 30_000;

export async function POST(request: Request) {
  try {
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = createServiceClient();
    try {
      await cleanupOldWebhookDeliveries(supabase);
    } catch {
      console.error("[CRON_PROCESS_REVIEWS] Webhook delivery cleanup failed, continuing job processing");
    }

    const startTime = Date.now();
    const deadline = startTime + INTERNAL_BUDGET_MS;

    const processedJobs = await processRunnableJobs(supabase, deadline);

    if (processedJobs.length === 0) {
      return NextResponse.json({ processed: 0 }, { status: 200 });
    }

    return NextResponse.json(
      { processed: processedJobs.length, jobs: processedJobs },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[CRON_PROCESS_REVIEWS]", error);
    return NextResponse.json(
      {
        error: "internal",
      },
      { status: 500 }
    );
  }
}

export async function cleanupOldWebhookDeliveries(
  supabase: SupabaseClient,
  olderThanDays = 7
): Promise<number> {
  const { data, error } = await supabase.rpc("cleanup_old_webhook_deliveries", {
    days: olderThanDays,
  });

  if (error) {
    console.error("[CRON_CLEANUP_DELIVERIES] Failed to cleanup old deliveries");
    throw new Error(error.message);
  }

  return typeof data === "number" ? data : 0;
}

function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = process.env.CRON_SECRET;
  if (!authHeader || !secret) return false;
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const key = "prpilot-cron-hmac-key";
  const tokenHmac = crypto.createHmac("sha256", key).update(token).digest();
  const secretHmac = crypto.createHmac("sha256", key).update(secret).digest();

  return crypto.timingSafeEqual(tokenHmac, secretHmac);
}

async function processRunnableJobs(
  supabase: SupabaseClient,
  deadline: number
): Promise<string[]> {
  const processedJobs: string[] = [];

  while (Date.now() < deadline - SAFETY_BUFFER_MS) {
    const canClaimDeferred = await checkCanClaimDeferred(supabase);
    const { data: claimedJobs, error } = await supabase.rpc(
      "claim_review_jobs",
      {
        claim_limit: 3,
        stale_seconds: 180,
        include_deferred: canClaimDeferred,
        max_retries: CONFIG.MAX_JOB_RETRIES,
      }
    );

    if (error) {
      console.error("[CRON_PROCESS_REVIEWS] RPC claim error:", error);
      break;
    }

    const jobs = (claimedJobs || []) as ReviewJob[];
    if (jobs.length === 0) break;

    const processedBatch = await executeClaimedBatch(jobs, deadline);
    processedJobs.push(...processedBatch);

    if (jobs.length < 3 || processedBatch.length < jobs.length) {
      break;
    }
  }

  return processedJobs;
}

async function executeClaimedBatch(
  jobs: ReviewJob[],
  deadline: number
): Promise<string[]> {
  const batchProcessed: string[] = [];

  for (const job of jobs) {
    if (Date.now() >= deadline - SAFETY_BUFFER_MS) {
      break;
    }

    try {
      await processReview(job.id);
      batchProcessed.push(job.id);
    } catch (err: unknown) {
      console.error(`[CRON_PROCESS_REVIEWS] Error processing job ${job.id}:`, err);
    }
  }

  return batchProcessed;
}

async function checkCanClaimDeferred(
  supabase: SupabaseClient
): Promise<boolean> {
  const dailyLimit = process.env.GEMINI_DAILY_LIMIT
    ? parseInt(process.env.GEMINI_DAILY_LIMIT, 10)
    : 1500;

  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await supabase
    .from("daily_api_usage")
    .select("call_count")
    .eq("usage_date", today)
    .maybeSingle();

  const currentCount = row?.call_count ?? 0;
  return currentCount < dailyLimit;
}
