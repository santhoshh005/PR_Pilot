import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ReviewList } from "@/components/dashboard/review-list";
import { ReviewItem, ReviewCommentItem } from "@/components/dashboard/review-detail-modal";

export const instant = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

interface RepoPageProps {
  params: Promise<{ repoId: string }>;
  searchParams?: Promise<{ page?: string; limit?: string }>;
}

export default async function RepoReviewsPage({
  params,
  searchParams,
}: RepoPageProps) {
  const { repoId } = await params;

  // Validate UUID
  if (!repoId || !UUID_REGEX.test(repoId)) {
    notFound();
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const rawPage = parseInt(resolvedSearchParams.page || "1", 10);
  const rawLimit = parseInt(resolvedSearchParams.limit || `${DEFAULT_PAGE_SIZE}`, 10);

  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_PAGE_SIZE : Math.min(rawLimit, MAX_PAGE_SIZE);

  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let repo: {
    id: string;
    full_name: string;
    name: string;
    owner: string;
    is_active: boolean;
    created_at: string;
  } | null = null;

  let reviews: ReviewItem[] = [];
  let totalReviewsCount = 0;
  let hasError = false;

  try {
    // 1. Fetch Repository under RLS
    const { data: repoData, error: repoError } = await userClient
      .from("repos")
      .select("id, full_name, name, owner, is_active, created_at")
      .eq("id", repoId)
      .single();

    if (repoError || !repoData) {
      if (repoError?.code === "PGRST116" || (!repoError && !repoData)) {
        notFound();
      }
      console.error("[REPO_PAGE] Failed to fetch repository:", repoError?.message);
      hasError = true;
    } else {
      repo = repoData;
    }

    if (repo) {
      // 2. Fetch Paginated Reviews
      const offset = (page - 1) * limit;
      const {
        data: reviewsData,
        error: reviewsError,
        count,
      } = await userClient
        .from("reviews")
        .select(
          "id, repo_id, pr_number, pr_title, pr_author, head_sha, summary, risk_score, severity_counts, inline_comment_count, created_at",
          { count: "exact" }
        )
        .eq("repo_id", repoId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (reviewsError) {
        console.error("[REPO_PAGE] Failed to fetch reviews:", reviewsError.message);
        hasError = true;
      } else {
        totalReviewsCount = count || 0;
        const baseReviews = (reviewsData || []) as ReviewItem[];

        // 3. Fetch Comments for these reviews if any exist
        if (baseReviews.length > 0) {
          const reviewIds = baseReviews.map((r) => r.id);
          const { data: commentsData, error: commentsError } = await userClient
            .from("review_comments")
            .select(
              "id, review_id, file_path, line_number, side, severity, title, body, suggestion"
            )
            .in("review_id", reviewIds);

          if (commentsError) {
            console.error(
              "[REPO_PAGE] Failed to fetch review comments:",
              commentsError.message
            );
          }

          const commentsByReviewId = new Map<string, ReviewCommentItem[]>();
          for (const comm of (commentsData || []) as ReviewCommentItem[]) {
            const list = commentsByReviewId.get(comm.review_id) || [];
            list.push(comm);
            commentsByReviewId.set(comm.review_id, list);
          }

          reviews = baseReviews.map((r) => ({
            ...r,
            comments: commentsByReviewId.get(r.id) || [],
          }));
        }
      }
    }
  } catch (err: any) {
    if (err?.message === "NEXT_NOT_FOUND") {
      throw err;
    }
    console.error("[REPO_PAGE] Unexpected error:", err?.message || err);
    hasError = true;
  }

  // Generic Error State
  if (hasError || !repo) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center shadow-xs">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-4">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Unable to load reviews
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          Something went wrong while loading repository reviews. Please try refreshing the page.
        </p>
        <div className="mt-6">
          <Link
            href={`/dashboard/${repoId}`}
            className="inline-flex items-center justify-center rounded-lg font-medium transition-colors border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 h-8 px-3 text-xs gap-1.5"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
        <Link href="/dashboard" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
          Repositories
        </Link>
        <span>/</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          {repo.full_name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {repo.full_name}
            </h1>
            <Badge variant={repo.is_active ? "success" : "secondary"} className="text-xs">
              {repo.is_active ? "Active" : "Paused"}
            </Badge>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Automated PR review history and findings for this repository.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${repoId}/settings`}
            className="inline-flex items-center justify-center rounded-lg font-medium transition-colors border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 h-9 px-3.5 text-xs gap-1.5 shadow-2xs"
          >
            <svg className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>
      </div>

      {/* Review List */}
      <ReviewList
        reviews={reviews}
        totalCount={totalReviewsCount}
        currentPage={page}
        limit={limit}
        repoId={repoId}
      />
    </div>
  );
}
