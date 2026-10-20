import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAppOctokit, getInstallationOctokit } from "@/lib/github/app";
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

    // 4. Filter only installations whose account matches the signed-in user (personal accounts only)
    const userInstallations = allInstallations.filter((inst) => {
      const isUserType =
        inst.target_type === "User" || inst.account?.type === "User";
      if (!isUserType || !inst.account) return false;

      const idMatch =
        inst.account.id !== undefined &&
        Number(inst.account.id) === Number(profile.github_user_id);

      const loginMatch =
        Boolean(inst.account.login) &&
        inst.account.login!.toLowerCase() === profile.github_username.toLowerCase();

      return idMatch || loginMatch;
    });

    // 5. Clean up installations that GitHub no longer returns for this user
    const { data: existingUserInstallations } = await serviceClient
      .from("installations")
      .select("id, installation_id")
      .eq("owner_id", profile.id);

    const activeGitHubInstIds = new Set(userInstallations.map((i) => i.id));
    for (const existingInst of existingUserInstallations || []) {
      if (!activeGitHubInstIds.has(Number(existingInst.installation_id))) {
        await serviceClient
          .from("installations")
          .delete()
          .eq("id", existingInst.id);
      }
    }

    let totalSyncedRepos = 0;

    // 6. For each valid personal installation, upsert installation and sync its repositories
    for (const inst of userInstallations) {
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

      const activeGitHubRepoIds = new Set(gitHubRepos.map((r) => r.id));
      for (const existingRepo of existingRepos || []) {
        if (!activeGitHubRepoIds.has(Number(existingRepo.github_repo_id))) {
          await serviceClient
            .from("repos")
            .delete()
            .eq("id", existingRepo.id);
        }
      }

      // 9. Upsert repos and create default repo_settings
      for (const repo of gitHubRepos) {
        // SERVICE_ROLE: upsert repo row
        const { data: dbRepo, error: repoUpsertErr } = await serviceClient
          .from("repos")
          .upsert(
            {
              installation_id: dbInst.id,
              github_repo_id: repo.id,
              owner: repo.owner.login,
              name: repo.name,
              full_name: repo.full_name,
              is_active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "github_repo_id" }
          )
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
      }
    }

    return NextResponse.json(
      {
        installations: userInstallations.length,
        repos: totalSyncedRepos,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string } | null;
    if (err?.status === 403 || err?.status === 429) {
      console.warn("[INSTALLATIONS_SYNC] GitHub rate limit encountered:", err?.message);
      const errorResponse: ApiError = {
        error: "rate_limit_exceeded",
        message: "GitHub rate limit exceeded. Please try again later.",
        status: 429,
      };
      return NextResponse.json(errorResponse, { status: 429 });
    }

    console.error("[INSTALLATIONS_SYNC] Unexpected error:", error);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to sync installations",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
