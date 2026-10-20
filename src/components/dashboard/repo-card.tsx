import * as React from "react";
import Link from "next/link";
import { DashboardRepo } from "@/types";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface RepoCardProps {
  repo: DashboardRepo;
}

export function RepoCard({ repo }: RepoCardProps) {
  const getRiskBadge = () => {
    if (repo.avg_risk_score === null || repo.total_reviews === 0) {
      return (
        <Badge variant="outline" className="text-zinc-500 dark:text-zinc-400">
          No reviews yet
        </Badge>
      );
    }

    if (repo.avg_risk_score <= 30) {
      return (
        <Badge variant="success">
          Risk: {repo.avg_risk_score}
        </Badge>
      );
    }

    if (repo.avg_risk_score < 70) {
      return (
        <Badge variant="warning">
          Risk: {repo.avg_risk_score}
        </Badge>
      );
    }

    return (
      <Badge variant="destructive">
        Risk: {repo.avg_risk_score}
      </Badge>
    );
  };

  const formattedDate = repo.last_review_at
    ? new Date(repo.last_review_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <Card className="hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors flex flex-col justify-between">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base truncate">
            <Link
              href={`/dashboard/${repo.id}`}
              className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 rounded"
            >
              {repo.full_name}
            </Link>
          </CardTitle>
          <Badge
            variant={repo.is_active ? "outline" : "secondary"}
            className="shrink-0 text-[10px] tracking-wide uppercase"
          >
            {repo.is_active ? "Active" : "Paused"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <div className="text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {repo.total_reviews} {repo.total_reviews === 1 ? "review" : "reviews"}
            </span>
          </div>
          <div>{getRiskBadge()}</div>
        </div>
      </CardContent>

      <CardFooter className="border-t border-zinc-100 dark:border-zinc-800/60 pt-4 flex items-center justify-between text-xs text-zinc-500">
        <span>{formattedDate ? `Last reviewed ${formattedDate}` : "Never reviewed"}</span>
        <Link
          href={`/dashboard/${repo.id}`}
          className="text-zinc-700 dark:text-zinc-300 font-medium hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          View reviews &rarr;
        </Link>
      </CardFooter>
    </Card>
  );
}
