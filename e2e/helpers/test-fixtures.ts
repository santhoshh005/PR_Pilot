import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface SupabaseConfig {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  webhookSecret: string;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  username: string;
  githubUserId: number;
}

export interface SeededData {
  installationId: string;
  repoId: string;
  settingsId: string;
  deliveryId: string;
  jobId: string;
  reviewId: string;
  commentId: string;
}

export interface TrackedEntities {
  userIds: string[];
  installationIds: string[];
  repoIds: string[];
  settingsIds: string[];
  deliveryIds: string[];
  jobIds: string[];
  reviewIds: string[];
  commentIds: string[];
}

export const MAIN_PROFILE_ID =
  process.env.E2E_PROTECTED_PROFILE_ID ?? "f183cb2d-716d-4a4b-971a-69e22ecc7052";

export function getSupabaseConfig(): SupabaseConfig {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const fileEnv: Record<string, string> = {};

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
    process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  const webhookSecret =
    process.env.GITHUB_WEBHOOK_SECRET ||
    fileEnv.GITHUB_WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET ||
    fileEnv.WEBHOOK_SECRET ||
    "";

  return { supabaseUrl, anonKey, serviceKey, webhookSecret };
}

export function getAdminClient(): SupabaseClient {
  const config = getSupabaseConfig();
  if (!config.supabaseUrl || !config.serviceKey) {
    throw new Error("Missing Supabase admin configuration");
  }
  return createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false },
  });
}

export async function createTestUser(
  adminClient: SupabaseClient,
  prefix: string
): Promise<TestUser> {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const email = `e2e-${prefix}-${timestamp}-${randomSuffix}@example.com`;
  const password = "E2eTestPassword123!@#";
  const username = `e2e-${prefix}-${timestamp}`;
  const githubUserId = Math.floor(30000000 + Math.random() * 60000000);

  const { data: resUser, error: errUser } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { user_name: username },
  });

  if (errUser || !resUser.user) {
    throw new Error(`Failed to create test user ${prefix}: ${errUser?.message}`);
  }

  const userId = resUser.user.id;

  const { error: errProfile } = await adminClient.from("profiles").insert({
    id: userId,
    github_user_id: githubUserId,
    github_username: username,
    avatar_url: `https://avatars.githubusercontent.com/u/${githubUserId}?v=4`,
  });

  if (errProfile) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(`Failed to insert profile for test user ${prefix}: ${errProfile.message}`);
  }

  return {
    id: userId,
    email,
    password,
    username,
    githubUserId,
  };
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

export async function getUserAuthCookies(
  user: TestUser
): Promise<PlaywrightCookie[]> {
  const config = getSupabaseConfig();
  const cookiesList: Array<{
    name: string;
    value: string;
    options?: { path?: string; httpOnly?: boolean; secure?: boolean };
  }> = [];

  const ssrClient = createServerClient(config.supabaseUrl, config.anonKey, {
    cookies: {
      getAll() {
        return cookiesList;
      },
      setAll(toSet) {
        toSet.forEach((c) => {
          const idx = cookiesList.findIndex((item) => item.name === c.name);
          if (idx !== -1) cookiesList[idx] = c;
          else cookiesList.push(c);
        });
      },
    },
  });

  const { error: signInErr } = await ssrClient.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  if (signInErr) {
    throw new Error(`Failed to sign in user for auth cookies: ${signInErr.message}`);
  }

  return cookiesList.map((c) => ({
    name: c.name,
    value: c.value,
    domain: "localhost",
    path: c.options?.path || "/",
    httpOnly: Boolean(c.options?.httpOnly),
    secure: Boolean(c.options?.secure),
    sameSite: "Lax",
  }));
}

export async function seedUserData(
  adminClient: SupabaseClient,
  userA: TestUser
): Promise<SeededData> {
  const timestamp = Date.now();
  const installationId = crypto.randomUUID();
  const repoId = crypto.randomUUID();
  const settingsId = crypto.randomUUID();
  const deliveryId = `e2e-delivery-${timestamp}-${Math.floor(Math.random() * 10000)}`;
  const jobId = crypto.randomUUID();
  const reviewId = crypto.randomUUID();
  const commentId = crypto.randomUUID();

  const githubInstId = Math.floor(40000000 + Math.random() * 50000000);
  const githubRepoId = Math.floor(40000000 + Math.random() * 50000000);

  // 1. Installation
  const { error: instErr } = await adminClient.from("installations").insert({
    id: installationId,
    installation_id: githubInstId,
    owner_id: userA.id,
    account_login: userA.username,
    account_type: "User",
  });
  if (instErr) throw new Error(`Failed to seed installation: ${instErr.message}`);

  // 2. Repo
  const { error: repoErr } = await adminClient.from("repos").insert({
    id: repoId,
    installation_id: installationId,
    github_repo_id: githubRepoId,
    owner: userA.username,
    name: "e2e-test-repo",
    full_name: `${userA.username}/e2e-test-repo`,
    is_active: true,
  });
  if (repoErr) throw new Error(`Failed to seed repo: ${repoErr.message}`);

  // 3. Repo Settings
  const { error: setErr } = await adminClient.from("repo_settings").insert({
    id: settingsId,
    repo_id: repoId,
    strictness: "balanced",
    custom_instructions: "Please prioritize performance and type safety.",
    ignored_paths: ["*.md", "docs/**"],
  });
  if (setErr) throw new Error(`Failed to seed repo_settings: ${setErr.message}`);

  // 4. Webhook delivery
  const { error: delErr } = await adminClient.from("webhook_deliveries").insert({
    delivery_id: deliveryId,
    event: "pull_request",
    action: "opened",
  });
  if (delErr) throw new Error(`Failed to seed delivery: ${delErr.message}`);

  // 5. Review Job
  const { error: jobErr } = await adminClient.from("review_jobs").insert({
    id: jobId,
    repo_id: repoId,
    pr_number: 42,
    pr_title: "<script>alert('xss-job-title')</script> Fix auth token handling",
    pr_author: "contributor-bob",
    head_sha: "1234567890abcdef1234567890abcdef12345678",
    base_sha: "abcdef1234567890abcdef1234567890abcdef12",
    delivery_id: deliveryId,
    status: "completed",
  });
  if (jobErr) throw new Error(`Failed to seed review_job: ${jobErr.message}`);

  // 6. Review (includes hostile script tags for XSS verification)
  const { error: revErr } = await adminClient.from("reviews").insert({
    id: reviewId,
    job_id: jobId,
    repo_id: repoId,
    pr_number: 42,
    pr_title: "<script>alert('xss-pr-title')</script> Fix auth token handling",
    pr_author: "contributor-bob",
    head_sha: "1234567890abcdef1234567890abcdef12345678",
    summary: "<img src=x onerror=alert('xss-summary')> Automated AI review for PR #42. Looks good overall with 1 security warning.",
    risk_score: 65,
    severity_counts: { critical: 1, warning: 1, suggestion: 1, praise: 1 },
    inline_comment_count: 1,
    review_duration_ms: 1800,
  });
  if (revErr) throw new Error(`Failed to seed review: ${revErr.message}`);

  // 7. Review Comment (includes hostile script tags for XSS verification)
  const { error: commErr } = await adminClient.from("review_comments").insert({
    id: commentId,
    review_id: reviewId,
    file_path: "src/lib/auth.ts",
    line_number: 25,
    severity: "critical",
    title: "<b onmouseover=alert('xss-title')>Check boundary validation</b>",
    body: "<script>alert('xss-comment')</script> Potential vulnerability: unescaped parameter.",
  });
  if (commErr) throw new Error(`Failed to seed comment: ${commErr.message}`);

  return {
    installationId,
    repoId,
    settingsId,
    deliveryId,
    jobId,
    reviewId,
    commentId,
  };
}

export async function cleanupTestData(
  adminClient: SupabaseClient,
  tracked: TrackedEntities
): Promise<void> {
  // Delete records by exact ID in reverse dependency order
  for (const commentId of tracked.commentIds) {
    const { error } = await adminClient.from("review_comments").delete().eq("id", commentId);
    if (error) console.error("Cleanup comment error:", error.message);
  }

  for (const reviewId of tracked.reviewIds) {
    const { error } = await adminClient.from("reviews").delete().eq("id", reviewId);
    if (error) console.error("Cleanup review error:", error.message);
  }

  for (const jobId of tracked.jobIds) {
    const { error } = await adminClient.from("review_jobs").delete().eq("id", jobId);
    if (error) console.error("Cleanup job error:", error.message);
  }

  for (const deliveryId of tracked.deliveryIds) {
    const { error } = await adminClient.from("webhook_deliveries").delete().eq("delivery_id", deliveryId);
    if (error) console.error("Cleanup delivery error:", error.message);
  }

  for (const settingsId of tracked.settingsIds) {
    const { error } = await adminClient.from("repo_settings").delete().eq("id", settingsId);
    if (error) console.error("Cleanup settings error:", error.message);
  }

  for (const repoId of tracked.repoIds) {
    const { error } = await adminClient.from("repos").delete().eq("id", repoId);
    if (error) console.error("Cleanup repo error:", error.message);
  }

  for (const installationId of tracked.installationIds) {
    const { error } = await adminClient.from("installations").delete().eq("id", installationId);
    if (error) console.error("Cleanup installation error:", error.message);
  }

  for (const userId of tracked.userIds) {
    const { error: profileErr } = await adminClient.from("profiles").delete().eq("id", userId);
    if (profileErr) console.error("Cleanup profile error:", profileErr.message);

    const { error: userErr } = await adminClient.auth.admin.deleteUser(userId);
    if (userErr) console.error("Cleanup auth user error:", userErr.message);
  }

  // SAFETY CHECK: If protected profile ID is specified, verify it is STILL INTACT
  if (MAIN_PROFILE_ID) {
    const { data: mainProfile, error: mainProfileErr } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id", MAIN_PROFILE_ID)
      .maybeSingle();

    if (mainProfileErr || !mainProfile) {
      throw new Error(`CRITICAL: Protected profile row ${MAIN_PROFILE_ID} was deleted or not found!`);
    }
    expect(mainProfile.id).toBe(MAIN_PROFILE_ID);
  }
}
