"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { ReviewDetailModal, ReviewItem } from "./review-detail-modal";

interface ReviewListProps {
  reviews: ReviewItem[];
  totalCount: number;
  currentPage: number;
  limit: number;
  repoId: string;
}

export function ReviewList({
  reviews,
  totalCount,
  currentPage,
  limit,
  repoId,
}: ReviewListProps) {
  const [selectedReview, setSelectedReview] = useState<ReviewItem | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 p-12 text-center bg-white dark:bg-zinc-900/40">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 mb-4">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          No reviews yet
        </h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          Pull requests will appear here once reviewed by PRPilot.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4">
        {reviews.map((review) => {
          const riskBadgeVariant =
            review.risk_score <= 30
              ? "success"
              : review.risk_score <= 69
              ? "warning"
              : "destructive";

          const formattedDate = new Date(review.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          });

          return (
            <Card key={review.id} className="hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      #{review.pr_number} {review.pr_title}
                    </CardTitle>
                    <Badge variant={riskBadgeVariant} className="text-xs">
                      Risk: {review.risk_score}
                    </Badge>
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formattedDate}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="pb-3">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  by <span className="font-medium text-zinc-700 dark:text-zinc-300">{review.pr_author}</span> · Head commit <code className="text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{review.head_sha.slice(0, 7)}</code>
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                  {review.summary}
                </p>
              </CardContent>

              <CardFooter className="pt-2 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/60">
                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{review.inline_comment_count ?? (review.comments?.length || 0)} inline comments</span>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedReview(review)}
                >
                  View Details
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800 text-sm">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Page {currentPage} of {totalPages}
        </span>

        <div className="flex items-center gap-2">
          {hasPrevious ? (
            <Link
              href={`/dashboard/${repoId}?page=${currentPage - 1}&limit=${limit}`}
              className="inline-flex items-center justify-center rounded-lg font-medium transition-colors border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 h-8 px-3 text-xs gap-1.5"
            >
              Previous
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}

          {hasNext ? (
            <Link
              href={`/dashboard/${repoId}?page=${currentPage + 1}&limit=${limit}`}
              className="inline-flex items-center justify-center rounded-lg font-medium transition-colors border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 h-8 px-3 text-xs gap-1.5"
            >
              Next
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <ReviewDetailModal
        isOpen={selectedReview !== null}
        onClose={() => setSelectedReview(null)}
        review={selectedReview}
      />
    </div>
  );
}
