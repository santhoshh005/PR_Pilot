import * as React from "react";
import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { RepoCard } from "@/components/dashboard/repo-card";
import { Button } from "@/components/ui/button";
import { DashboardRepo } from "@/types";

export const instant = false;

export default async function DashboardPage() {
  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let repos: any[] | null = null;
  let reviews: any[] | null = null;
  let hasError = false;

  try {
    const { data: reposData, error: reposError } = await userClient
      .from("repos")
      .select("id, full_name, owner, name, is_active, created_at")
      .order("full_name", { ascending: true });

    if (reposError) {
      console.error("[DASHBOARD_PAGE] Failed to fetch repos:", reposError.message);
      hasError = true;
    } else {
      repos = reposData;
    }

    if (repos && repos.length > 0) {
      const repoIds = repos.map((r) => r.id);
      const { data: reviewsData, error: reviewsError } = await userClient
        .from("reviews")
        .select("repo_id, risk_score, created_at")
        .in("repo_id", repoIds);

      if (reviewsError) {
        console.error("[DASHBOARD_PAGE] Failed to fetch reviews:", reviewsError.message);
      } else {
        reviews = reviewsData;
      }
    }
  } catch (err: any) {
    console.error("[DASHBOARD_PAGE] Unexpected error:", err?.message || err);
    hasError = true;
  }

  // Generic Error State
  if (hasError || repos === null) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center shadow-xs">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-4">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Unable to load repositories
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          Something went wrong while loading your repositories. Please try refreshing the page.
        </p>
        <div className="mt-6">
          <form action="/dashboard" method="GET">
            <Button type="submit" variant="outline" size="sm">
              Retry
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Empty State
  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 mb-4">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          No repositories found
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          You haven&apos;t connected any repositories yet. Install the PRPilot GitHub App or sync your installations to get started.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
          <form action="/api/installations/sync" method="POST">
            <Button type="submit" variant="default" size="sm">
              Sync Repositories
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Aggregate review stats per repo
  const reviewsByRepo = new Map<string, Array<{ risk_score: number; created_at: string }>>();
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Repositories
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Automated code review metrics and status for your connected repositories
          </p>
        </div>
        <form action="/api/installations/sync" method="POST">
          <Button type="submit" variant="outline" size="sm">
            <svg
              className="h-3.5 w-3.5 mr-1.5"
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
            Sync Repositories
          </Button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {dashboardRepos.map((repo) => (
          <RepoCard key={repo.id} repo={repo} />
        ))}
      </div>
    </div>
  );
}
