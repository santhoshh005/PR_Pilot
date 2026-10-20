"use client";

import React, { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ReviewCommentItem {
  id: string;
  review_id: string;
  file_path: string;
  line_number: number;
  side: "LEFT" | "RIGHT";
  severity: "critical" | "warning" | "suggestion" | "praise";
  title: string;
  body: string;
  suggestion?: string | null;
}

export interface ReviewItem {
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
  inline_comment_count?: number;
  created_at: string;
  comments?: ReviewCommentItem[];
}

interface ReviewDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: ReviewItem | null;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function ReviewDetailModal({
  isOpen,
  onClose,
  review,
  triggerRef,
}: ReviewDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Handle Escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    // Save previous active element if triggerRef not provided
    const previouslyFocused = triggerRef?.current || (document.activeElement as HTMLElement | null);

    // Focus close button on mount
    closeButtonRef.current?.focus();

    // Prevent background scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        if (!dialogRef.current) return;
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen || !review) return null;

  const riskBadgeVariant =
    review.risk_score <= 30
      ? "success"
      : review.risk_score <= 69
      ? "warning"
      : "destructive";

  const criticalCount = review.severity_counts?.critical || 0;
  const warningCount = review.severity_counts?.warning || 0;
  const suggestionCount = review.severity_counts?.suggestion || 0;
  const praiseCount = review.severity_counts?.praise || 0;

  const comments = review.comments || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-xs transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      aria-hidden={!isOpen}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-dialog-title"
        aria-describedby="review-dialog-summary"
        className="flex flex-col w-full max-w-3xl max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
          <div className="space-y-1.5 pr-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="review-dialog-title"
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              >
                #{review.pr_number} {review.pr_title}
              </h2>
              <Badge variant={riskBadgeVariant} className="text-xs">
                Risk: {review.risk_score}
              </Badge>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Authored by <span className="font-medium text-zinc-700 dark:text-zinc-300">{review.pr_author}</span> · Head commit <code className="text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{review.head_sha.slice(0, 8)}</code>
            </p>
          </div>

          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Severity Badges Summary */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mr-1">
              Findings:
            </span>
            <Badge variant="destructive" className="text-xs">
              {criticalCount} Critical
            </Badge>
            <Badge variant="warning" className="text-xs">
              {warningCount} Warning
            </Badge>
            <Badge variant="default" className="text-xs">
              {suggestionCount} Suggestion
            </Badge>
            <Badge variant="success" className="text-xs">
              {praiseCount} Praise
            </Badge>
          </div>

          {/* Review Summary */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Review Summary
            </h3>
            <div
              id="review-dialog-summary"
              className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800 text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap"
            >
              {review.summary}
            </div>
          </div>

          {/* Inline Comments */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              Inline Comments
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                ({comments.length})
              </span>
            </h3>

            {comments.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500 dark:text-zinc-400">
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
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2 bg-white dark:bg-zinc-900/60"
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

                      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {comment.title}
                      </h4>

                      <p className="text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                        {comment.body}
                      </p>

                      {comment.suggestion && (
                        <div className="mt-2 space-y-1">
                          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                            Suggested change:
                          </span>
                          <pre className="p-2.5 rounded bg-zinc-950 text-zinc-100 text-xs font-mono overflow-x-auto whitespace-pre">
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

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
