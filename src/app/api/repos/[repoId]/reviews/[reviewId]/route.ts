import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserClient } from "@/lib/supabase/server";
import { ApiError, Review, ReviewComment } from "@/types";

const ParamsSchema = z.object({
  repoId: z.string().uuid("Invalid repository ID"),
  reviewId: z.string().uuid("Invalid review ID"),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repoId: string; reviewId: string }> }
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
        message: parsedParams.error.issues[0]?.message || "Invalid ID format",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const { repoId, reviewId } = parsedParams.data;

    // Check repo access via RLS
    const { data: repo, error: repoError } = await userClient
      .from("repos")
      .select("id")
      .eq("id", repoId)
      .maybeSingle();

    if (repoError) {
      console.error("[GET_SINGLE_REVIEW] Database error checking repo:", repoError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve review",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!repo) {
      const errorResponse: ApiError = {
        error: "not_found",
        message: "Review not found",
        status: 404,
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Query single review via RLS
    const { data: review, error: reviewError } = await userClient
      .from("reviews")
      .select("*")
      .eq("id", reviewId)
      .eq("repo_id", repoId)
      .maybeSingle();

    if (reviewError) {
      console.error("[GET_SINGLE_REVIEW] Database error querying review:", reviewError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve review",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!review) {
      const errorResponse: ApiError = {
        error: "not_found",
        message: "Review not found",
        status: 404,
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Query inline comments for this review via RLS
    const { data: comments, error: commentsError } = await userClient
      .from("review_comments")
      .select("*")
      .eq("review_id", reviewId)
      .order("created_at", { ascending: true });

    if (commentsError) {
      console.error("[GET_SINGLE_REVIEW] Database error querying comments:", commentsError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve review comments",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    return NextResponse.json(
      {
        review: review as Review,
        comments: (comments || []) as ReviewComment[],
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[GET_SINGLE_REVIEW] Unexpected error:", error);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to retrieve review",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
