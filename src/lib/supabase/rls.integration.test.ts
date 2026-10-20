import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

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

  const expectedRef = "ajsvejrikxaqztbnctwj";
  const expectedUrlInEnv = fileEnv.NEXT_PUBLIC_SUPABASE_URL;

  return {
    supabaseUrl,
    anonKey,
    serviceKey,
    expectedRef,
    expectedUrlInEnv,
  };
}

const config = getSupabaseConfig();
const hasRequiredEnv = Boolean(
  config.supabaseUrl && config.anonKey && config.serviceKey
);

// Safety guard: Ensure the test target strictly matches .env.local and PR_Pilot ref
if (hasRequiredEnv) {
  if (config.expectedUrlInEnv && config.supabaseUrl !== config.expectedUrlInEnv) {
    throw new Error(
      `Safety guard: Supabase URL (${config.supabaseUrl}) does not match .env.local (${config.expectedUrlInEnv})`
    );
  }
  if (!config.supabaseUrl?.includes(config.expectedRef)) {
    throw new Error(
      `Safety guard: Supabase URL must belong to PR_Pilot (expected ref ${config.expectedRef}), received: ${config.supabaseUrl}`
    );
  }
}

const runOrSkip = hasRequiredEnv ? describe : describe.skip;

runOrSkip("Live Supabase Row Level Security (RLS) Integration Tests", () => {
  let serviceClient: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let clientAnon: SupabaseClient;

  let userAId: string;
  let userBId: string;
  const testPassword = "TestPassword123!@#";
  const timestamp = Date.now();
  const userAEmail = `rls-test-user-a-${timestamp}@example.com`;
  const userBEmail = `rls-test-user-b-${timestamp}@example.com`;

  let installationAId: string;
  let repoAId: string;
  let repoSettingsAId: string;
  let deliveryId: string;
  let reviewJobAId: string;
  let reviewChunkAId: string;
  let reviewAId: string;
  let reviewCommentAId: string;

  beforeAll(async () => {
    serviceClient = createClient(config.supabaseUrl!, config.serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    clientAnon = createClient(config.supabaseUrl!, config.anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Create User A and User B via admin auth
    const { data: userARes, error: userAErr } =
      await serviceClient.auth.admin.createUser({
        email: userAEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { user_name: "test-user-a" },
      });
    if (userAErr || !userARes?.user) {
      throw new Error(`Failed to create test user A: ${userAErr?.message}`);
    }
    userAId = userARes.user.id;

    const { data: userBRes, error: userBErr } =
      await serviceClient.auth.admin.createUser({
        email: userBEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { user_name: "test-user-b" },
      });
    if (userBErr || !userBRes?.user) {
      throw new Error(`Failed to create test user B: ${userBErr?.message}`);
    }
    userBId = userBRes.user.id;

    // 2. Insert profiles for User A and User B
    const githubIdA = Math.floor(10000000 + Math.random() * 90000000);
    const githubIdB = Math.floor(10000000 + Math.random() * 90000000);

    const { error: profAErr } = await serviceClient.from("profiles").insert({
      id: userAId,
      github_user_id: githubIdA,
      github_username: "test-user-a",
      avatar_url: "https://example.com/a.png",
    });
    if (profAErr) throw new Error(`Failed to insert profile A: ${profAErr.message}`);

    const { error: profBErr } = await serviceClient.from("profiles").insert({
      id: userBId,
      github_user_id: githubIdB,
      github_username: "test-user-b",
      avatar_url: "https://example.com/b.png",
    });
    if (profBErr) throw new Error(`Failed to insert profile B: ${profBErr.message}`);

    // 3. Create installation owned by User A
    const randomInstId = Math.floor(1000000 + Math.random() * 9000000);
    const { data: instData, error: instErr } = await serviceClient
      .from("installations")
      .insert({
        installation_id: randomInstId,
        owner_id: userAId,
        account_login: "user-a-org",
        account_type: "User",
      })
      .select()
      .single();
    if (instErr || !instData) {
      throw new Error(`Failed to create installation: ${instErr?.message}`);
    }
    installationAId = instData.id;

    // 4. Create repository under installation A
    const randomRepoId = Math.floor(1000000 + Math.random() * 9000000);
    const { data: repoData, error: repoErr } = await serviceClient
      .from("repos")
      .insert({
        installation_id: installationAId,
        github_repo_id: randomRepoId,
        owner: "user-a-org",
        name: "repo-a",
        full_name: "user-a-org/repo-a",
        is_active: true,
      })
      .select()
      .single();
    if (repoErr || !repoData) {
      throw new Error(`Failed to create repo: ${repoErr?.message}`);
    }
    repoAId = repoData.id;

    // 5. Create repo settings for repo A
    const { data: settData, error: settErr } = await serviceClient
      .from("repo_settings")
      .insert({
        repo_id: repoAId,
        ignored_paths: ["dist/**"],
        strictness: "strict",
        custom_instructions: "User A instructions",
      })
      .select()
      .single();
    if (settErr || !settData) {
      throw new Error(`Failed to create repo_settings: ${settErr?.message}`);
    }
    repoSettingsAId = settData.id;

    // 6. Create webhook delivery
    deliveryId = `test-del-${timestamp}-${Math.floor(Math.random() * 10000)}`;
    const { error: delErr } = await serviceClient
      .from("webhook_deliveries")
      .insert({
        delivery_id: deliveryId,
        event: "pull_request",
        action: "opened",
      });
    if (delErr) {
      throw new Error(`Failed to create webhook_delivery: ${delErr.message}`);
    }

    // 7. Create review job for repo A
    const { data: jobData, error: jobErr } = await serviceClient
      .from("review_jobs")
      .insert({
        repo_id: repoAId,
        pr_number: 101,
        pr_title: "Feature PR A",
        pr_author: "author-a",
        head_sha: "head12345678",
        base_sha: "base12345678",
        delivery_id: deliveryId,
        status: "completed",
        total_chunks: 1,
        completed_chunks: 1,
      })
      .select()
      .single();
    if (jobErr || !jobData) {
      throw new Error(`Failed to create review_job: ${jobErr?.message}`);
    }
    reviewJobAId = jobData.id;

    // 8. Create review chunk
    const { data: chunkData, error: chunkErr } = await serviceClient
      .from("review_chunks")
      .insert({
        job_id: reviewJobAId,
        chunk_index: 0,
        file_path: "src/index.ts",
        diff_content: "+const test = 1;",
        status: "completed",
        review_json: { summary: "LGTM", risk_score: 10 },
      })
      .select()
      .single();
    if (chunkErr || !chunkData) {
      throw new Error(`Failed to create review_chunk: ${chunkErr?.message}`);
    }
    reviewChunkAId = chunkData.id;

    // 9. Create review for repo A
    const { data: revData, error: revErr } = await serviceClient
      .from("reviews")
      .insert({
        job_id: reviewJobAId,
        repo_id: repoAId,
        pr_number: 101,
        pr_title: "Feature PR A",
        pr_author: "author-a",
        head_sha: "head12345678",
        summary: "Detailed review summary",
        risk_score: 25,
        severity_counts: { critical: 0, warning: 1, suggestion: 0, praise: 0 },
        inline_comment_count: 1,
      })
      .select()
      .single();
    if (revErr || !revData) {
      throw new Error(`Failed to create review: ${revErr?.message}`);
    }
    reviewAId = revData.id;

    // 10. Create review comment
    const { data: commData, error: commErr } = await serviceClient
      .from("review_comments")
      .insert({
        review_id: reviewAId,
        file_path: "src/index.ts",
        line_number: 1,
        side: "RIGHT",
        severity: "warning",
        title: "Test comment title",
        body: "Test comment body explanation",
      })
      .select()
      .single();
    if (commErr || !commData) {
      throw new Error(`Failed to create review_comment: ${commErr?.message}`);
    }
    reviewCommentAId = commData.id;

    // 11. Authenticate Client A
    clientA = createClient(config.supabaseUrl!, config.anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: authAErr } = await clientA.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    if (authAErr) throw new Error(`Auth failed for user A: ${authAErr.message}`);

    // 12. Authenticate Client B
    clientB = createClient(config.supabaseUrl!, config.anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: authBErr } = await clientB.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    if (authBErr) throw new Error(`Auth failed for user B: ${authBErr.message}`);
  }, 30000);

  afterAll(async () => {
    // Clean up all created test data and users, even if tests fail
    try {
      if (serviceClient) {
        if (userAId) {
          await serviceClient.auth.admin.deleteUser(userAId);
        }
        if (userBId) {
          await serviceClient.auth.admin.deleteUser(userBId);
        }
        if (deliveryId) {
          await serviceClient
            .from("webhook_deliveries")
            .delete()
            .eq("delivery_id", deliveryId);
        }
      }
    } catch (cleanupErr) {
      console.error("Cleanup error in rls.integration.test.ts:", cleanupErr);
    }
  }, 30000);

  it("user B cannot read user A's installations, repos, repo_settings, review_jobs, reviews, or review_comments", async () => {
    // Installations: user B sees empty results
    const { data: insts, error: instsErr } = await clientB
      .from("installations")
      .select("*")
      .eq("id", installationAId);
    expect(instsErr).toBeNull();
    expect(insts).toEqual([]);

    // Repos: user B sees empty results
    const { data: repos, error: reposErr } = await clientB
      .from("repos")
      .select("*")
      .eq("id", repoAId);
    expect(reposErr).toBeNull();
    expect(repos).toEqual([]);

    // Repo settings: user B sees empty results
    const { data: settings, error: settErr } = await clientB
      .from("repo_settings")
      .select("*")
      .eq("id", repoSettingsAId);
    expect(settErr).toBeNull();
    expect(settings).toEqual([]);

    // Review jobs: user B sees empty results
    const { data: jobs, error: jobsErr } = await clientB
      .from("review_jobs")
      .select("*")
      .eq("id", reviewJobAId);
    expect(jobsErr).toBeNull();
    expect(jobs).toEqual([]);

    // Review chunks: user B sees empty results
    const { data: chunks, error: chunksErr } = await clientB
      .from("review_chunks")
      .select("*")
      .eq("id", reviewChunkAId);
    expect(chunksErr).toBeNull();
    expect(chunks).toEqual([]);

    // Reviews: user B sees empty results
    const { data: reviews, error: revsErr } = await clientB
      .from("reviews")
      .select("*")
      .eq("id", reviewAId);
    expect(revsErr).toBeNull();
    expect(reviews).toEqual([]);

    // Review comments: user B sees empty results
    const { data: comments, error: commsErr } = await clientB
      .from("review_comments")
      .select("*")
      .eq("id", reviewCommentAId);
    expect(commsErr).toBeNull();
    expect(comments).toEqual([]);

    // Profiles: user B cannot read user A's profile
    const { data: profs, error: profsErr } = await clientB
      .from("profiles")
      .select("*")
      .eq("id", userAId);
    expect(profsErr).toBeNull();
    expect(profs).toEqual([]);
  }, 30000);

  it("user B cannot update user A's repo_settings", async () => {
    const { data: updateRes, error: updateErr } = await clientB
      .from("repo_settings")
      .update({ custom_instructions: "MALICIOUS_UPDATE" })
      .eq("repo_id", repoAId)
      .select();

    expect(updateErr).toBeNull();
    expect(updateRes).toEqual([]);

    // Verify row remains untouched in database
    const { data: verified, error: verifyErr } = await serviceClient
      .from("repo_settings")
      .select("custom_instructions")
      .eq("repo_id", repoAId)
      .single();

    expect(verifyErr).toBeNull();
    expect(verified?.custom_instructions).toBe("User A instructions");
  });

  it("anonymous (unauthenticated) client reads nothing from any table", async () => {
    const { data: p } = await clientAnon.from("profiles").select("*");
    expect(p ?? []).toEqual([]);

    const { data: i } = await clientAnon.from("installations").select("*");
    expect(i ?? []).toEqual([]);

    const { data: r } = await clientAnon.from("repos").select("*");
    expect(r ?? []).toEqual([]);

    const { data: s } = await clientAnon.from("repo_settings").select("*");
    expect(s ?? []).toEqual([]);

    const { data: w } = await clientAnon.from("webhook_deliveries").select("*");
    expect(w ?? []).toEqual([]);

    const { data: j } = await clientAnon.from("review_jobs").select("*");
    expect(j ?? []).toEqual([]);

    const { data: ch } = await clientAnon.from("review_chunks").select("*");
    expect(ch ?? []).toEqual([]);

    const { data: rev } = await clientAnon.from("reviews").select("*");
    expect(rev ?? []).toEqual([]);

    const { data: comm } = await clientAnon.from("review_comments").select("*");
    expect(comm ?? []).toEqual([]);
  });

  it("user A CAN read their own rows across all tables", async () => {
    // Profile
    const { data: profs, error: profErr } = await clientA
      .from("profiles")
      .select("*")
      .eq("id", userAId);
    expect(profErr).toBeNull();
    expect(profs?.length).toBe(1);
    expect(profs?.[0]?.github_username).toBe("test-user-a");

    // Installation
    const { data: insts, error: instErr } = await clientA
      .from("installations")
      .select("*")
      .eq("id", installationAId);
    expect(instErr).toBeNull();
    expect(insts?.length).toBe(1);

    // Repo
    const { data: repos, error: repoErr } = await clientA
      .from("repos")
      .select("*")
      .eq("id", repoAId);
    expect(repoErr).toBeNull();
    expect(repos?.length).toBe(1);

    // Repo Settings
    const { data: settings, error: settErr } = await clientA
      .from("repo_settings")
      .select("*")
      .eq("repo_id", repoAId);
    expect(settErr).toBeNull();
    expect(settings?.length).toBe(1);
    expect(settings?.[0]?.custom_instructions).toBe("User A instructions");

    // Review Jobs
    const { data: jobs, error: jobErr } = await clientA
      .from("review_jobs")
      .select("*")
      .eq("id", reviewJobAId);
    expect(jobErr).toBeNull();
    expect(jobs?.length).toBe(1);

    // Review Chunks
    const { data: chunks, error: chunkErr } = await clientA
      .from("review_chunks")
      .select("*")
      .eq("id", reviewChunkAId);
    expect(chunkErr).toBeNull();
    expect(chunks?.length).toBe(1);

    // Reviews
    const { data: reviews, error: revErr } = await clientA
      .from("reviews")
      .select("*")
      .eq("id", reviewAId);
    expect(revErr).toBeNull();
    expect(reviews?.length).toBe(1);

    // Review Comments
    const { data: comments, error: commErr } = await clientA
      .from("review_comments")
      .select("*")
      .eq("id", reviewCommentAId);
    expect(commErr).toBeNull();
    expect(comments?.length).toBe(1);
  });

  it("user A CAN update their own repo_settings and profile", async () => {
    // Update repo_settings
    const { data: updatedSettings, error: updateSettErr } = await clientA
      .from("repo_settings")
      .update({ custom_instructions: "Updated by Owner A" })
      .eq("repo_id", repoAId)
      .select();

    expect(updateSettErr).toBeNull();
    expect(updatedSettings?.length).toBe(1);
    expect(updatedSettings?.[0]?.custom_instructions).toBe(
      "Updated by Owner A"
    );

    // Update profile
    const { data: updatedProfile, error: updateProfErr } = await clientA
      .from("profiles")
      .update({ avatar_url: "https://example.com/a-new.png" })
      .eq("id", userAId)
      .select();

    expect(updateProfErr).toBeNull();
    expect(updatedProfile?.length).toBe(1);
    expect(updatedProfile?.[0]?.avatar_url).toBe(
      "https://example.com/a-new.png"
    );
  });
});
