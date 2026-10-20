import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { DashboardRepo, ApiError } from "@/types";

export async function GET(request: Request) {
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

    // Query user's repos via RLS
    const { data: repos, error: reposError } = await userClient
      .from("repos")
      .select("id, full_name, owner, name, is_active, created_at")
      .order("full_name", { ascending: true });

    if (reposError) {
      console.error("[GET_REPOS] Database error fetching repos:", reposError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to fetch repositories",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!repos || repos.length === 0) {
      return NextResponse.json({ repos: [] }, { status: 200 });
    }

    // Query review metrics for user's repos via RLS
    const { data: reviews, error: reviewsError } = await userClient
      .from("reviews")
      .select("repo_id, risk_score, created_at");

    if (reviewsError) {
      console.error("[GET_REPOS] Database error fetching reviews:", reviewsError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to fetch repositories",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Map reviews to repositories
    const reviewsByRepo = new Map<
      string,
      Array<{ risk_score: number; created_at: string }>
    >();

    for (const rev of reviews || []) {
      const list = reviewsByRepo.get(rev.repo_id) || [];
      list.push(rev);
      reviewsByRepo.set(rev.repo_id, list);
    }

    const dashboardRepos: DashboardRepo[] = repos.map((repo) => {
      const repoReviews = reviewsByRepo.get(repo.id) || [];
      const totalReviews = repoReviews.length;

      let avgRiskScore: number | null = null;
      let lastReviewAt: string | null = null;

      if (totalReviews > 0) {
        const totalScore = repoReviews.reduce((sum, r) => sum + r.risk_score, 0);
        avgRiskScore = Math.round(totalScore / totalReviews);

        // Find most recent review created_at
        let latestTime = 0;
        for (const r of repoReviews) {
          const t = new Date(r.created_at).getTime();
          if (t > latestTime) {
            latestTime = t;
            lastReviewAt = r.created_at;
          }
        }
      }

      return {
        id: repo.id,
        full_name: repo.full_name,
        owner: repo.owner,
        name: repo.name,
        is_active: repo.is_active,
        total_reviews: totalReviews,
        avg_risk_score: avgRiskScore,
        last_review_at: lastReviewAt,
      };
    });

    return NextResponse.json({ repos: dashboardRepos }, { status: 200 });
  } catch (error: any) {
    if (error?.digest === "HANGING_PROMISE_REJECTION") {
      throw error;
    }
    console.error("[GET_REPOS] Unexpected error:", error);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to fetch repositories",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
