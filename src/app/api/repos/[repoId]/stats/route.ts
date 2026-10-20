import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserClient } from "@/lib/supabase/server";
import { checkDashboardRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  ApiError,
  RepoStatsResponse,
  SeverityBreakdown,
  RiskScoreTrend,
} from "@/types";

const ParamsSchema = z.object({
  repoId: z.string().uuid("Invalid repository ID"),
});

const MAX_STATS_ROWS = 1000;

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  try {
    const userClient = await createUserClient();
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      const errorResponse: ApiError = {
        error: "unauthorized",
        message: "Authentication required",
        status: 401,
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const rateLimit = await checkDashboardRateLimit(user.id);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfter);
    }

    const rawParams = await params;
    const parsedParams = ParamsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: parsedParams.error.issues[0]?.message || "Invalid repository ID",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const { repoId } = parsedParams.data;

    const url = new URL(request.url);
    const parsedQuery = QuerySchema.safeParse({
      days: url.searchParams.get("days") ?? undefined,
    });

    if (!parsedQuery.success) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: parsedQuery.error.issues[0]?.message || "Invalid query parameters",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const { days } = parsedQuery.data;

    // Verify repository exists and belongs to authenticated user (RLS-enforced)
    const { data: repo, error: repoError } = await userClient
      .from("repos")
      .select("id")
      .eq("id", repoId)
      .maybeSingle();

    if (repoError) {
      console.error("[GET_REPO_STATS] Database error checking repo:", repoError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve repository statistics",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!repo) {
      const errorResponse: ApiError = {
        error: "not_found",
        message: "Repository not found",
        status: 404,
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Bounded lookback window
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: reviews, error: reviewsError } = await userClient
      .from("reviews")
      .select("id, risk_score, severity_counts, review_duration_ms, created_at")
      .eq("repo_id", repoId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(MAX_STATS_ROWS);

    if (reviewsError) {
      console.error("[GET_REPO_STATS] Database error querying reviews:", reviewsError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve repository statistics",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    const reviewList = reviews || [];
    const totalReviews = reviewList.length;

    let totalDuration = 0;
    const dailyMap = new Map<
      string,
      {
        critical: number;
        warning: number;
        suggestion: number;
        praise: number;
        riskScores: number[];
      }
    >();

    for (const r of reviewList) {
      totalDuration += r.review_duration_ms || 0;
      const dateKey = (r.created_at || "").slice(0, 10);
      if (!dateKey) continue;

      const current = dailyMap.get(dateKey) || {
        critical: 0,
        warning: 0,
        suggestion: 0,
        praise: 0,
        riskScores: [],
      };

      const counts = r.severity_counts || {};
      current.critical += counts.critical || 0;
      current.warning += counts.warning || 0;
      current.suggestion += counts.suggestion || 0;
      current.praise += counts.praise || 0;
      current.riskScores.push(r.risk_score || 0);

      dailyMap.set(dateKey, current);
    }

    const severityBreakdown: SeverityBreakdown[] = [];
    const riskTrend: RiskScoreTrend[] = [];

    // Sort dates chronologically
    const sortedDates = Array.from(dailyMap.keys()).sort();

    for (const d of sortedDates) {
      const stats = dailyMap.get(d)!;
      severityBreakdown.push({
        date: d,
        critical: stats.critical,
        warning: stats.warning,
        suggestion: stats.suggestion,
        praise: stats.praise,
      });

      const avgRisk =
        stats.riskScores.length > 0
          ? Math.round(
              stats.riskScores.reduce((sum, score) => sum + score, 0) /
                stats.riskScores.length
            )
          : 0;

      riskTrend.push({
        date: d,
        avg_risk_score: avgRisk,
        review_count: stats.riskScores.length,
      });
    }

    const avgReviewDurationMs =
      totalReviews > 0 ? Math.round(totalDuration / totalReviews) : 0;

    const response: RepoStatsResponse = {
      severity_breakdown: severityBreakdown,
      risk_trend: riskTrend,
      total_reviews: totalReviews,
      avg_review_duration_ms: avgReviewDurationMs,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error: unknown) {
    console.error("[GET_REPO_STATS] Unexpected error:", error);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to retrieve repository statistics",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
