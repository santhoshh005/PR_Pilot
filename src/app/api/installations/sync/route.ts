import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAppOctokit, getInstallationOctokit } from "@/lib/github/app";
import { checkDashboardRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { ApiError } from "@/types";

interface GitHubAccount {
  id?: number;
  login?: string;
  type?: string;
}

interface GitHubInstallation {
  id: number;
  account: GitHubAccount | null;
  target_type?: string;
  suspended_at?: string | null;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private?: boolean;
}

export async function POST(request?: Request) {
  void request;
  try {
    // 1. Authenticate user using getUser() (never getSession())
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

    // Rate limit per authenticated user
    const rateLimit = await checkDashboardRateLimit(user.id);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfter);
    }

    // 2. Fetch user's profile to obtain their GitHub identity
    // SERVICE_ROLE: user profile lookup for installation matching
    const serviceClient = createServiceClient();
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("id, github_user_id, github_username")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      const errorResponse: ApiError = {
        error: "unauthorized",
        message: "User profile not found",
        status: 401,
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    // 3. Fetch all GitHub App installations using App-level credentials (paginated)
    const appOctokit = getAppOctokit();
    let page = 1;
    const allInstallations: GitHubInstallation[] = [];

    while (true) {
      const { data } = await appOctokit.rest.apps.listInstallations({
        per_page: 100,
        page,
      });

      if (!data || data.length === 0) break;
      allInstallations.push(...(data as GitHubInstallation[]));
      if (data.length < 100) break;
      page++;
    }

    // 4. Filter only installations whose account matches the signed-in user (personal accounts only, strict account.id match)
    const userInstallations = allInstallations.filter((inst) => {
      const isUserType =
        inst.target_type === "User" || inst.account?.type === "User";
      if (!isUserType || !inst.account || inst.account.id === undefined) return false;

      return Number(inst.account.id) === Number(profile.github_user_id);
    });

    // 5. Clean up installations that GitHub no longer returns for this user
    const { data: existingUserInstallations } = await serviceClient
      .from("installations")
      .select("id, installation_id")
      .eq("owner_id", profile.id);

    const activeGitHubInstIds = new Set(userInstallations.map((i) => i.id));
    const instIdsToDelete = (existingUserInstallations || [])
      .filter((inst) => !activeGitHubInstIds.has(Number(inst.installation_id)))
      .map((inst) => inst.id);

    if (instIdsToDelete.length > 0) {
      await serviceClient
        .from("installations")
        .delete()
        .in("id", instIdsToDelete);
    }

    let totalSyncedInstallations = 0;
    let totalSyncedRepos = 0;
    let totalBackfilledJobs = 0;

    // 6. For each valid personal installation, upsert installation and sync its repositories
    for (const inst of userInstallations) {
      // Guard against taking over an installation already registered by another user
      const { data: existingDbInst } = await serviceClient
        .from("installations")
        .select("id, owner_id")
        .eq("installation_id", inst.id)
        .maybeSingle();

      if (existingDbInst && existingDbInst.owner_id !== profile.id) {
        console.warn(
          `[INSTALLATIONS_SYNC] Installation ${inst.id} belongs to owner ${existingDbInst.owner_id}, refusing takeover by ${profile.id}`
        );
        continue;
      }

      // SERVICE_ROLE: upsert installation row
      const { data: dbInst, error: instUpsertErr } = await serviceClient
        .from("installations")
        .upsert(
          {
            installation_id: inst.id,
            owner_id: profile.id,
            account_login: inst.account?.login || profile.github_username,
            account_type: "User",
            suspended_at: inst.suspended_at || null,
          },
          { onConflict: "installation_id" }
        )
        .select("id, installation_id")
        .single();

      if (instUpsertErr || !dbInst) {
        console.error(
          `[INSTALLATIONS_SYNC] Failed to upsert installation ${inst.id}:`,
          instUpsertErr?.message
        );
        continue;
      }

      totalSyncedInstallations++;

      // 7. Fetch repos accessible to this installation (paginated)
      const instOctokit = getInstallationOctokit(inst.id);
      let repoPage = 1;
      const gitHubRepos: GitHubRepo[] = [];

      while (true) {
        const { data } = await instOctokit.rest.apps.listReposAccessibleToInstallation({
          per_page: 100,
          page: repoPage,
        });

        const repos = (data?.repositories as GitHubRepo[]) || [];
        if (repos.length === 0) break;
        gitHubRepos.push(...repos);
        if (repos.length < 100) break;
        repoPage++;
      }

      // 8. Clean up removed repos that GitHub no longer returns for this installation
      const { data: existingRepos } = await serviceClient
        .from("repos")
        .select("id, github_repo_id")
        .eq("installation_id", dbInst.id);

      const existingRepoGithubIds = new Set(
        (existingRepos || []).map((r) => Number(r.github_repo_id))
      );

      const activeGitHubRepoIds = new Set(gitHubRepos.map((r) => r.id));
      const repoIdsToDelete = (existingRepos || [])
        .filter((r) => !activeGitHubRepoIds.has(Number(r.github_repo_id)))
        .map((r) => r.id);

      if (repoIdsToDelete.length > 0) {
        await serviceClient
          .from("repos")
          .delete()
          .in("id", repoIdsToDelete);
      }

      // 9. Upsert repos and create default repo_settings
      for (const repo of gitHubRepos) {
        const isNewRepo = !existingRepoGithubIds.has(Number(repo.id));

        const repoData: Record<string, unknown> = {
          installation_id: dbInst.id,
          github_repo_id: repo.id,
          owner: repo.owner.login,
          name: repo.name,
          full_name: repo.full_name,
          updated_at: new Date().toISOString(),
        };

        // Only default is_active to true for brand-new repositories so we don't overwrite user preferences
        if (isNewRepo) {
          repoData.is_active = true;
        }

        // SERVICE_ROLE: upsert repo row
        const { data: dbRepo, error: repoUpsertErr } = await serviceClient
          .from("repos")
          .upsert(repoData, { onConflict: "github_repo_id" })
          .select("id, github_repo_id")
          .single();

        if (repoUpsertErr || !dbRepo) {
          console.error(
            `[INSTALLATIONS_SYNC] Failed to upsert repo ${repo.full_name}:`,
            repoUpsertErr?.message
          );
          continue;
        }

        // SERVICE_ROLE: default repo_settings creation (no INSERT policy for authenticated users)
        await serviceClient
          .from("repo_settings")
          .upsert(
            {
              repo_id: dbRepo.id,
              ignored_paths: [],
              strictness: "balanced",
              custom_instructions: "",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "repo_id", ignoreDuplicates: true }
          );

        totalSyncedRepos++;

        // 10. Backfill open PRs for newly synced repositories (capped at 5 per repo, max 20 total per sync)
        if (isNewRepo && totalBackfilledJobs < 20) {
          try {
            const { data: openPulls } = await instOctokit.rest.pulls.list({
              owner: repo.owner.login,
              repo: repo.name,
              state: "open",
              per_page: 10,
            });

            const eligiblePulls = (openPulls || [])
              .filter(
                (pr) =>
                  !pr.draft &&
                  pr.head?.sha &&
                  pr.base?.sha &&
                  pr.number !== undefined
              )
              .slice(0, Math.min(5, 20 - totalBackfilledJobs));

            for (const pr of eligiblePulls) {
              const deliveryId = `backfill-sync-${dbRepo.id}-${pr.number}-${pr.head.sha}`;
              const { error: delErr } = await serviceClient
                .from("webhook_deliveries")
                .insert({
                  delivery_id: deliveryId,
                  event: "pull_request",
                  action: "opened",
                });

              if (delErr) continue;

              const { error: jobErr } = await serviceClient
                .from("review_jobs")
                .insert({
                  repo_id: dbRepo.id,
                  pr_number: pr.number,
                  pr_title: pr.title || `PR #${pr.number}`,
                  pr_author: pr.user?.login || "unknown",
                  head_sha: pr.head.sha,
                  base_sha: pr.base.sha,
                  delivery_id: deliveryId,
                  status: "pending",
                });

              if (!jobErr) {
                totalBackfilledJobs++;
              }
            }
          } catch (backfillErr) {
            console.warn(
              `[INSTALLATIONS_SYNC] Failed to backfill open PRs for repo ${repo.full_name}:`,
              backfillErr
            );
          }
        }
      }
    }

    return NextResponse.json(
      {
        installations: totalSyncedInstallations,
        repos: totalSyncedRepos,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; name?: string } | null;
    const errMessage = err?.message || "";
    const errName = err?.name || "Error";
    const errStatus = err?.status;

    if (
      errMessage === "GITHUB_KEY_MISSING" ||
      errMessage === "GITHUB_KEY_INVALID" ||
      errMessage.startsWith("GITHUB_KEY_") ||
      errMessage === "GITHUB_APP_ID_MISSING" ||
      errMessage.startsWith("GITHUB_APP_ID")
    ) {
      console.error("[INSTALLATIONS_SYNC] GitHub App configuration error:", {
        name: errName,
        message: errMessage,
        status: 503,
      });
      const errorResponse: ApiError = {
        error: "github_app_not_configured",
        message: "The GitHub App is not configured correctly. Please contact the site owner.",
        status: 503,
      };
      return NextResponse.json(errorResponse, { status: 503 });
    }

    if (errStatus === 403 || errStatus === 429) {
      console.warn("[INSTALLATIONS_SYNC] GitHub rate limit encountered:", {
        name: errName,
        message: errMessage,
        status: errStatus,
      });
      const errorResponse: ApiError = {
        error: "rate_limit_exceeded",
        message: "GitHub rate limit exceeded. Please try again later.",
        status: 429,
      };
      return NextResponse.json(errorResponse, { status: 429 });
    }

    console.error("[INSTALLATIONS_SYNC] Unexpected error:", {
      name: errName,
      message: errMessage,
      status: errStatus || 500,
    });
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to sync installations",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
