import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ReviewCommentItem } from "@/components/dashboard/review-detail-modal";

export const instant = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ReviewPageProps {
  params: Promise<{ repoId: string; reviewId: string }>;
}

export default async function ReviewDetailPage({ params }: ReviewPageProps) {
  const { repoId, reviewId } = await params;

  if (
    !repoId ||
    !reviewId ||
    !UUID_REGEX.test(repoId) ||
    !UUID_REGEX.test(reviewId)
  ) {
    notFound();
  }

  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let repo: { id: string; full_name: string } | null = null;
  let review: {
    id: string;
    repo_id: string;
    pr_number: number;
    pr_title: string;
    pr_author: string;
    head_sha: string;
    summary: string;
    risk_score: number;
    severity_counts: {
      critical?: number;
      warning?: number;
      suggestion?: number;
      praise?: number;
    };
    created_at: string;
  } | null = null;
  let comments: ReviewCommentItem[] = [];
  let hasError = false;

  try {
    const { data: repoData, error: repoErr } = await userClient
      .from("repos")
      .select("id, full_name")
      .eq("id", repoId)
      .single();

    if (repoErr || !repoData) {
      if (repoErr?.code === "PGRST116" || (!repoErr && !repoData)) {
        notFound();
      }
      hasError = true;
    } else {
      repo = repoData;
    }

    if (repo) {
      const { data: revData, error: revErr } = await userClient
        .from("reviews")
        .select(
          "id, repo_id, pr_number, pr_title, pr_author, head_sha, summary, risk_score, severity_counts, created_at"
        )
        .eq("id", reviewId)
        .eq("repo_id", repoId)
        .single();

      if (revErr || !revData) {
        if (revErr?.code === "PGRST116" || (!revErr && !revData)) {
          notFound();
        }
        hasError = true;
      } else {
        review = revData;
      }

      if (review) {
        const { data: commData, error: commErr } = await userClient
          .from("review_comments")
          .select(
            "id, review_id, file_path, line_number, side, severity, title, body, suggestion"
          )
          .eq("review_id", reviewId);

        if (commErr) {
          console.error(
            "[REVIEW_DETAIL_PAGE] Failed to fetch comments:",
            commErr.message
          );
        } else {
          comments = (commData || []) as ReviewCommentItem[];
        }
      }
    }
  } catch (err: unknown) {
    const errorObj = err as { message?: string; digest?: string } | null;
    const msg = errorObj?.message || "";
    const digest = errorObj?.digest || "";
    if (msg.startsWith("NEXT_") || digest.startsWith("NEXT_")) {
      throw err;
    }
    console.error("[REVIEW_DETAIL_PAGE] Unexpected error:", err);
    hasError = true;
  }

  if (hasError || !repo || !review) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center shadow-xs">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Unable to load review details
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          Something went wrong while loading this review. Please try refreshing the page.
        </p>
      </div>
    );
  }

  const riskBadgeVariant =
    review.risk_score <= 30
      ? "success"
      : review.risk_score <= 69
      ? "warning"
      : "destructive";

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
        <Link href="/dashboard" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
          Repositories
        </Link>
        <span>/</span>
        <Link
          href={`/dashboard/${repoId}`}
          className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          {repo.full_name}
        </Link>
        <span>/</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          PR #{review.pr_number}
        </span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              #{review.pr_number} {review.pr_title}
            </h1>
            <Badge variant={riskBadgeVariant} className="text-xs">
              Risk: {review.risk_score}
            </Badge>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Authored by <span className="font-medium text-zinc-700 dark:text-zinc-300">{review.pr_author}</span> · Head commit <code className="text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{review.head_sha.slice(0, 7)}</code>
          </p>
        </div>
      </div>

      {/* Summary Box */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4 shadow-xs">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Review Summary
        </h2>
        <div className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap">
          {review.summary}
        </div>
      </div>

      {/* Inline Comments */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Inline Comments ({comments.length})
        </h2>

        {comments.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No inline comments were generated for this review.
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => {
              const commentBadgeVariant =
                comment.severity === "critical"
                  ? "destructive"
                  : comment.severity === "warning"
                  ? "warning"
                  : comment.severity === "suggestion"
                  ? "default"
                  : "success";

              return (
                <div
                  key={comment.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-2 bg-white dark:bg-zinc-900 shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={commentBadgeVariant} className="text-xs capitalize">
                        {comment.severity}
                      </Badge>
                      <span className="font-mono text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {comment.file_path}:{comment.line_number}
                      </span>
                    </div>
                    <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {comment.side}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {comment.title}
                  </h3>

                  <p className="text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                    {comment.body}
                  </p>

                  {comment.suggestion && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        Suggested change:
                      </span>
                      <pre className="p-3 rounded-lg bg-zinc-950 text-zinc-100 text-xs font-mono overflow-x-auto whitespace-pre">
                        {comment.suggestion}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
