import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserClient } from "@/lib/supabase/server";
import { ApiError, ReviewHistoryItem } from "@/types";

const ParamsSchema = z.object({
  repoId: z.string().uuid("Invalid repository ID"),
});

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
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
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    if (!parsedQuery.success) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: parsedQuery.error.issues[0]?.message || "Invalid query parameters",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const { page, limit } = parsedQuery.data;

    // Verify repository exists and belongs to authenticated user (RLS-enforced)
    const { data: repo, error: repoError } = await userClient
      .from("repos")
      .select("id")
      .eq("id", repoId)
      .maybeSingle();

    if (repoError) {
      console.error("[GET_REPO_REVIEWS] Database error querying repo:", repoError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve reviews",
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

    // Query reviews for the repository (paginated)
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: reviews, count, error: reviewsError } = await userClient
      .from("reviews")
      .select(
        `id, pr_number, pr_title, pr_author, head_sha, risk_score, severity_counts, inline_comment_count, review_duration_ms, created_at`,
        { count: "exact" }
      )
      .eq("repo_id", repoId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (reviewsError) {
      console.error("[GET_REPO_REVIEWS] Database error querying reviews:", reviewsError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve reviews",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    return NextResponse.json(
      {
        reviews: (reviews || []) as ReviewHistoryItem[],
        total: count ?? (reviews ? reviews.length : 0),
        page,
        limit,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[GET_REPO_REVIEWS] Unexpected error:", error);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to retrieve reviews",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
