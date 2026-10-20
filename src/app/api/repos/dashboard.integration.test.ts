import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { GET as getRepos } from "./route";
import { GET as getReviews } from "./[repoId]/reviews/route";
import { GET as getSingleReview } from "./[repoId]/reviews/[reviewId]/route";
import { GET as getStats } from "./[repoId]/stats/route";
import { GET as getSettings, PATCH as patchSettings } from "./[repoId]/settings/route";

function getSupabaseConfig() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  let fileEnv: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        fileEnv[key] = val;
      }
    }
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

  return { supabaseUrl, anonKey, serviceKey };
}

const config = getSupabaseConfig();
const canRunLive = Boolean(
  config.supabaseUrl && config.anonKey && config.serviceKey
);

let activeUserClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => activeUserClient),
}));

const runOrSkip = canRunLive ? describe : describe.skip;

runOrSkip("Live Dashboard API Endpoints Integration Test (Cross-User Isolation)", () => {
  let serviceClient: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  let realProfileId: string;
  let userAId: string;
  let userBId: string;
  const testPassword = "LiveTestPassword123!@#";
  const timestamp = Date.now();
  const userAEmail = `live-dash-a-${timestamp}@example.com`;
  const userBEmail = `live-dash-b-${timestamp}@example.com`;

  // Exact test record IDs
  const testInstAId = "00000000-0000-4000-a000-000000000301";
  const testRepoAId = "00000000-0000-4000-a000-000000000302";
  const testSettingsAId = "00000000-0000-4000-a000-000000000303";
  const testReviewAId = "00000000-0000-4000-a000-000000000304";
  const testCommentAId = "00000000-0000-4000-a000-000000000305";
  const testJobAId = "00000000-0000-4000-a000-000000000306";
  const testDeliveryA = `live-dash-delivery-${timestamp}`;

  const githubInstId = Math.floor(20000000 + Math.random() * 70000000);
  const githubRepoId = Math.floor(20000000 + Math.random() * 70000000);
  const githubUserA = Math.floor(20000000 + Math.random() * 70000000);
  const githubUserB = Math.floor(20000000 + Math.random() * 70000000);

  beforeAll(async () => {
    serviceClient = createClient(config.supabaseUrl!, config.serviceKey!, {
      auth: { persistSession: false },
    });

    // 1. Record real profile row to verify it remains intact at the end
    const { data: realProfiles } = await serviceClient
      .from("profiles")
      .select("id")
      .limit(1);
    expect(realProfiles && realProfiles.length > 0).toBe(true);
    realProfileId = realProfiles![0].id;

    // 2. Create User A and User B
    const { data: resA } = await serviceClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { user_name: "test-user-a" },
    });
    userAId = resA!.user!.id;

    const { data: resB } = await serviceClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { user_name: "test-user-b" },
    });
    userBId = resB!.user!.id;

    // 3. Create profiles
    await serviceClient.from("profiles").insert([
      {
        id: userAId,
        github_user_id: githubUserA,
        github_username: `live-a-${timestamp}`,
      },
      {
        id: userBId,
        github_user_id: githubUserB,
        github_username: `live-b-${timestamp}`,
      },
    ]);

    // 4. Create installation, repo, repo_settings, review, and comment for User A
    await serviceClient.from("installations").insert({
      id: testInstAId,
      installation_id: githubInstId,
      owner_id: userAId,
      account_login: `live-a-${timestamp}`,
      account_type: "User",
    });

    await serviceClient.from("repos").insert({
      id: testRepoAId,
      installation_id: testInstAId,
      github_repo_id: githubRepoId,
      owner: `live-a-${timestamp}`,
      name: "live-repo-a",
      full_name: `live-a-${timestamp}/live-repo-a`,
      is_active: true,
    });

    await serviceClient.from("repo_settings").insert({
      id: testSettingsAId,
      repo_id: testRepoAId,
      ignored_paths: ["*.log"],
      strictness: "balanced",
      custom_instructions: "Live initial instructions",
    });

    await serviceClient.from("webhook_deliveries").insert({
      delivery_id: testDeliveryA,
      event: "pull_request",
      action: "opened",
    });

    await serviceClient.from("review_jobs").insert({
      id: testJobAId,
      repo_id: testRepoAId,
      pr_number: 1,
      pr_title: "Live PR",
      pr_author: "author",
      head_sha: "head123",
      base_sha: "base123",
      delivery_id: testDeliveryA,
      status: "completed",
    });

    await serviceClient.from("reviews").insert({
      id: testReviewAId,
      job_id: testJobAId,
      repo_id: testRepoAId,
      pr_number: 1,
      pr_title: "Live PR",
      pr_author: "author",
      head_sha: "head123",
      summary: "Clean live review",
      risk_score: 45,
      severity_counts: { critical: 0, warning: 1, suggestion: 1, praise: 0 },
      inline_comment_count: 1,
      review_duration_ms: 1500,
    });

    await serviceClient.from("review_comments").insert({
      id: testCommentAId,
      review_id: testReviewAId,
      file_path: "src/index.ts",
      line_number: 10,
      severity: "warning",
      title: "Potential issue",
      body: "Check boundary condition",
    });

    // 5. Sign in client A and client B
    clientA = createClient(config.supabaseUrl!, config.anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await clientA.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });

    clientB = createClient(config.supabaseUrl!, config.anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await clientB.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
  }, 45000);

  afterAll(async () => {
    try {
      if (serviceClient) {
        // Delete only exact test IDs created
        await serviceClient.from("review_comments").delete().eq("id", testCommentAId);
        await serviceClient.from("reviews").delete().eq("id", testReviewAId);
        await serviceClient.from("review_jobs").delete().eq("id", testJobAId);
        await serviceClient.from("webhook_deliveries").delete().eq("delivery_id", testDeliveryA);
        await serviceClient.from("repo_settings").delete().eq("id", testSettingsAId);
        await serviceClient.from("repos").delete().eq("id", testRepoAId);
        await serviceClient.from("installations").delete().eq("id", testInstAId);

        if (userAId) await serviceClient.auth.admin.deleteUser(userAId);
        if (userBId) await serviceClient.auth.admin.deleteUser(userBId);

        // Verify real user profile still exists
        const { data: realProfileCheck } = await serviceClient
          .from("profiles")
          .select("id")
          .eq("id", realProfileId)
          .single();
        expect(realProfileCheck).toBeTruthy();
      }
    } catch (cleanupErr) {
      console.error("Cleanup error in dashboard.integration.test.ts:", cleanupErr);
    }
  }, 45000);

  it("User B receives 404 for User A's repo reviews, review details, and stats", async () => {
    activeUserClient = clientB;

    // 1. GET reviews
    const reqReviews = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/reviews`
    );
    const resReviews = await getReviews(reqReviews, {
      params: Promise.resolve({ repoId: testRepoAId }),
    });
    expect(resReviews.status).toBe(404);
    const bodyReviews = await resReviews.json();
    expect(bodyReviews.error).toBe("not_found");

    // 2. GET single review
    const reqSingle = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/reviews/${testReviewAId}`
    );
    const resSingle = await getSingleReview(reqSingle, {
      params: Promise.resolve({ repoId: testRepoAId, reviewId: testReviewAId }),
    });
    expect(resSingle.status).toBe(404);
    const bodySingle = await resSingle.json();
    expect(bodySingle.error).toBe("not_found");

    // 3. GET stats
    const reqStats = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/stats`
    );
    const resStats = await getStats(reqStats, {
      params: Promise.resolve({ repoId: testRepoAId }),
    });
    expect(resStats.status).toBe(404);
    const bodyStats = await resStats.json();
    expect(bodyStats.error).toBe("not_found");
  }, 30000);

  it("User B cannot PATCH User A's settings and receives 404", async () => {
    activeUserClient = clientB;

    const reqPatch = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({ custom_instructions: "Hacked instructions" }),
      }
    );

    const resPatch = await patchSettings(reqPatch, {
      params: Promise.resolve({ repoId: testRepoAId }),
    });
    expect(resPatch.status).toBe(404);
    const bodyPatch = await resPatch.json();
    expect(bodyPatch.error).toBe("not_found");

    // Verify settings in database were NOT modified
    const { data: unchangedSettings } = await serviceClient
      .from("repo_settings")
      .select("custom_instructions")
      .eq("id", testSettingsAId)
      .single();
    expect(unchangedSettings?.custom_instructions).toBe("Live initial instructions");
  }, 30000);

  it("User A CAN read their repos, reviews, single review, stats, and settings", async () => {
    activeUserClient = clientA;

    // 1. GET /api/repos
    const reqRepos = new Request("http://localhost:3000/api/repos");
    const resRepos = await getRepos(reqRepos);
    expect(resRepos.status).toBe(200);
    const bodyRepos = await resRepos.json();
    expect(bodyRepos.repos.some((r: any) => r.id === testRepoAId)).toBe(true);

    // 2. GET /api/repos/[repoId]/reviews
    const reqReviews = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/reviews`
    );
    const resReviews = await getReviews(reqReviews, {
      params: Promise.resolve({ repoId: testRepoAId }),
    });
    expect(resReviews.status).toBe(200);
    const bodyReviews = await resReviews.json();
    expect(bodyReviews.reviews).toHaveLength(1);
    expect(bodyReviews.reviews[0].id).toBe(testReviewAId);

    // 3. GET /api/repos/[repoId]/reviews/[reviewId]
    const reqSingle = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/reviews/${testReviewAId}`
    );
    const resSingle = await getSingleReview(reqSingle, {
      params: Promise.resolve({ repoId: testRepoAId, reviewId: testReviewAId }),
    });
    expect(resSingle.status).toBe(200);
    const bodySingle = await resSingle.json();
    expect(bodySingle.review.id).toBe(testReviewAId);
    expect(bodySingle.comments).toHaveLength(1);
    expect(bodySingle.comments[0].body).toBe("Check boundary condition");

    // 4. GET /api/repos/[repoId]/stats
    const reqStats = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/stats`
    );
    const resStats = await getStats(reqStats, {
      params: Promise.resolve({ repoId: testRepoAId }),
    });
    expect(resStats.status).toBe(200);
    const bodyStats = await resStats.json();
    expect(bodyStats.total_reviews).toBe(1);
    expect(bodyStats.avg_review_duration_ms).toBe(1500);

    // 5. GET /api/repos/[repoId]/settings
    const reqSettings = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/settings`
    );
    const resSettings = await getSettings(reqSettings, {
      params: Promise.resolve({ repoId: testRepoAId }),
    });
    expect(resSettings.status).toBe(200);
    const bodySettings = await resSettings.json();
    expect(bodySettings.settings.custom_instructions).toBe("Live initial instructions");
  }, 30000);

  it("User A CAN update (PATCH) their own repository settings", async () => {
    activeUserClient = clientA;

    const reqPatch = new Request(
      `http://localhost:3000/api/repos/${testRepoAId}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({
          strictness: "strict",
          custom_instructions: "Live updated instructions by User A",
          ignored_paths: ["docs/**", "*.tmp"],
        }),
      }
    );

    const resPatch = await patchSettings(reqPatch, {
      params: Promise.resolve({ repoId: testRepoAId }),
    });
    expect(resPatch.status).toBe(200);
    const bodyPatch = await resPatch.json();
    expect(bodyPatch.settings.strictness).toBe("strict");
    expect(bodyPatch.settings.custom_instructions).toBe(
      "Live updated instructions by User A"
    );
    expect(bodyPatch.settings.ignored_paths).toEqual(["docs/**", "*.tmp"]);

    // Verify in database
    const { data: dbCheck } = await serviceClient
      .from("repo_settings")
      .select("strictness, custom_instructions, ignored_paths")
      .eq("id", testSettingsAId)
      .single();
    expect(dbCheck?.strictness).toBe("strict");
    expect(dbCheck?.custom_instructions).toBe("Live updated instructions by User A");
    expect(dbCheck?.ignored_paths).toEqual(["docs/**", "*.tmp"]);
  }, 30000);
});
