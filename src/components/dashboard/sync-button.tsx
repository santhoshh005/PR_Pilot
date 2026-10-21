"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface SyncButtonProps {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  children?: React.ReactNode;
}

type SyncState = "idle" | "loading" | "success" | "rate_limited" | "error";

export function SyncButton({
  variant = "default",
  size = "sm",
  className,
  children,
}: SyncButtonProps) {
  let router: { refresh: () => void } | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    router = null;
  }

  const [state, setState] = React.useState<SyncState>("idle");
  const [feedbackMessage, setFeedbackMessage] = React.useState<string | null>(null);

  async function handleSync() {
    if (state === "loading") return;

    setState("loading");
    setFeedbackMessage(null);

    try {
      const res = await fetch("/api/installations/sync", {
        method: "POST",
      });

      if (res.status === 200) {
        setState("success");
        setFeedbackMessage("Repositories synced successfully.");
        if (router) {
          router.refresh();
        } else if (typeof window !== "undefined") {
          window.location.reload();
        }
      } else if (res.status === 429) {
        setState("rate_limited");
        setFeedbackMessage("Rate limit exceeded. Please try again later.");
      } else {
        setState("error");
        setFeedbackMessage("Failed to sync repositories. Please try again.");
      }
    } catch {
      setState("error");
      setFeedbackMessage("Failed to sync repositories. Please try again.");
    }
  }

  const isLoading = state === "loading";

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={isLoading}
        onClick={handleSync}
      >
        <svg
          className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {isLoading ? "Syncing..." : children || "Sync Repositories"}
      </Button>

      {feedbackMessage && (
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${
            state === "success"
              ? "text-emerald-600 dark:text-emerald-400 font-medium"
              : state === "rate_limited"
              ? "text-amber-600 dark:text-amber-400 font-medium"
              : "text-rose-600 dark:text-rose-400 font-medium"
          }`}
        >
          {feedbackMessage}
        </span>
      )}
    </div>
  );
}
