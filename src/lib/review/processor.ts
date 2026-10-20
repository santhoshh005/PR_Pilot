import { SupabaseClient } from "@supabase/supabase-js";
import {
  CONFIG,
  ChunkReviewResult,
  DiffChunk,
  FullReviewResult,
  Installation,
  Repo,
  RepoSettings,
  ReviewJob,
  ReviewJobStatus,
} from "@/types";
import { getInstallationOctokit } from "@/lib/github/app";
import { fetchDiff, parseDiff, ParsedDiffChunk } from "@/lib/github/diff-parser";
import {
  isUnavailableError,
  reviewChunk,
  ReviewContext,
} from "@/lib/gemini/review";
import { mergeChunkResults } from "@/lib/review/merger";
import { createServiceClient } from "@/lib/supabase/service";
import { postReviewToGitHub, PostReviewResult } from "@/lib/review/poster";

const DEFAULT_IGNORED_PATTERNS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "go.sum",
  "*.min.js",
  "*.min.css",
  "dist/**",
  "build/**",
  ".next/**",
];

interface JobContext {
  job: ReviewJob;
  repo: Repo;
  installation: Installation;
  settings: RepoSettings;
}

interface ChunkExecutionResult {
  chunkIndex: number;
  filePath: string;
  result: ChunkReviewResult | null;
  status: "completed" | "error" | "retry_later";
}

/**
 * Orchestrates pull request review processing:
 * 1. Checks duplicate head_sha and daily budget guards
 * 2. Fetches and chunks PR diff (skipping lockfiles/generated files)
 * 3. Enforces concurrency and chunk timeouts
 * 4. Tracks hard 250s deadline with try/finally to ensure final job status
 */
export async function processReview(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  const startTime = Date.now();

  try {
    const jobContext = await loadJobContext(supabase, jobId);
    if (!jobContext) return;

    await runReviewPipeline(supabase, jobContext, startTime);
  } catch (error: unknown) {
    await handleProcessReviewError(supabase, jobId, error);
  }
}

async function handleProcessReviewError(
  supabase: SupabaseClient,
  jobId: string,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[PROCESS_REVIEW] Job ${jobId} failed:`, message);

  await supabase
    .from("review_jobs")
    .update({ status: "error", error_message: message })
    .eq("id", jobId);
}

async function runReviewPipeline(
  supabase: SupabaseClient,
  context: JobContext,
  startTime: number
): Promise<void> {
  const { job, repo, installation, settings } = context;

  await supabase
    .from("review_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", job.id);

  if (await checkDuplicateShaReview(supabase, job)) return;
  if (await checkDailyBudgetExhausted(supabase, job.id)) return;

  const chunks = await prepareDiffChunks(installation, repo, job, settings);
  if (chunks.length === 0) {
    await finalizeEmptyDiffJob(supabase, job.id);
    return;
  }

  await initializeJobChunks(supabase, job.id, chunks);

  const reviewContext = buildReviewContext(repo, job, settings);
  const deadline = startTime + getDeadlineMs();
  const { executionResults, reachedDeadline } = await executeChunkReviews(
    supabase,
    job.id,
    chunks,
    reviewContext,
    deadline
  );

  await finalizeReviewJob(
    supabase,
    context,
    startTime,
    chunks,
    executionResults,
    reachedDeadline
  );
}

function buildReviewContext(
  repo: Repo,
  job: ReviewJob,
  settings: RepoSettings
): ReviewContext {
  return {
    repo_full_name: repo.full_name,
    pr_number: job.pr_number,
    pr_title: job.pr_title,
    pr_author: job.pr_author,
    strictness: settings.strictness,
    custom_instructions: settings.custom_instructions,
  };
}

async function loadJobContext(
  supabase: SupabaseClient,
  jobId: string
): Promise<JobContext | null> {
  const { data: job, error: jobError } = await supabase
    .from("review_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobError || !job) return null;
  if (job.status !== "pending" && job.status !== "processing") return null;

  const repo = await loadRepo(supabase, job.repo_id);
  if (!repo) return null;

  const installation = await loadInstallation(supabase, repo.installation_id);
  if (!installation) return null;

  const settings = await loadSettings(supabase, repo.id);
  return { job, repo, installation, settings };
}

async function loadRepo(supabase: SupabaseClient, repoId: string): Promise<Repo | null> {
  const { data } = await supabase
    .from("repos")
    .select("*")
    .eq("id", repoId)
    .single();
  return data;
}

async function loadInstallation(
  supabase: SupabaseClient,
  installationId: string
): Promise<Installation | null> {
  const { data } = await supabase
    .from("installations")
    .select("*")
    .eq("id", installationId)
    .single();
  return data;
}

async function loadSettings(
  supabase: SupabaseClient,
  repoId: string
): Promise<RepoSettings> {
  const { data } = await supabase
    .from("repo_settings")
    .select("*")
    .eq("repo_id", repoId)
    .maybeSingle();

  return (
    data || {
      id: "",
      repo_id: repoId,
      ignored_paths: [],
      strictness: "balanced",
      custom_instructions: "",
      created_at: "",
      updated_at: "",
    }
  );
}

async function checkDuplicateShaReview(
  supabase: SupabaseClient,
  job: ReviewJob
): Promise<boolean> {
  const { data: existingReview } = await supabase
    .from("reviews")
    .select("*")
    .eq("repo_id", job.repo_id)
    .eq("head_sha", job.head_sha)
    .maybeSingle();

  if (!existingReview) return false;

  await copyExistingReview(supabase, job, existingReview);

  await supabase
    .from("review_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return true;
}

async function copyExistingReview(
  supabase: SupabaseClient,
  job: ReviewJob,
  existingReview: any
): Promise<void> {
  const { data: existingComments } = await supabase
    .from("review_comments")
    .select("*")
    .eq("review_id", existingReview.id);

  const { data: newReview } = await supabase
    .from("reviews")
    .insert({
      job_id: job.id,
      repo_id: job.repo_id,
      pr_number: job.pr_number,
      pr_title: job.pr_title,
      pr_author: job.pr_author,
      head_sha: job.head_sha,
      summary: existingReview.summary,
      risk_score: existingReview.risk_score,
      severity_counts: existingReview.severity_counts,
      inline_comment_count: existingReview.inline_comment_count,
      review_duration_ms: existingReview.review_duration_ms,
    })
    .select("id")
    .single();

  if (newReview && existingComments && existingComments.length > 0) {
    const commentsToInsert = existingComments.map((c: any) => ({
      review_id: newReview.id,
      file_path: c.file_path,
      line_number: c.line_number,
      side: c.side || "RIGHT",
      severity: c.severity,
      title: c.title,
      body: c.body,
      suggestion: c.suggestion,
    }));
    await supabase.from("review_comments").insert(commentsToInsert);
  }
}

async function checkDailyBudgetExhausted(
  supabase: SupabaseClient,
  jobId: string
): Promise<boolean> {
  const dailyLimit = process.env.GEMINI_DAILY_LIMIT
    ? parseInt(process.env.GEMINI_DAILY_LIMIT, 10)
    : 1500;

  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await supabase
    .from("daily_api_usage")
    .select("call_count")
    .eq("usage_date", today)
    .maybeSingle();

  const currentCount = row?.call_count ?? 0;
  if (currentCount >= dailyLimit) {
    await supabase
      .from("review_jobs")
      .update({
        status: "deferred",
        error_message: "Daily Gemini API budget exhausted",
      })
      .eq("id", jobId);
    return true;
  }

  return false;
}

async function prepareDiffChunks(
  installation: Installation,
  repo: Repo,
  job: ReviewJob,
  settings: RepoSettings
): Promise<ParsedDiffChunk[]> {
  const octokit = getInstallationOctokit(installation.installation_id);
  const diffText = await fetchDiff(octokit, repo.owner, repo.name, job.pr_number);

  const combinedIgnored = Array.from(
    new Set([...settings.ignored_paths, ...DEFAULT_IGNORED_PATTERNS])
  );

  const parsedChunks = parseDiff(diffText, {
    ignoredPaths: combinedIgnored,
    maxTokens: CONFIG.MAX_CHUNK_TOKENS,
  });

  return combineSmallChunks(parsedChunks);
}

function combineSmallChunks(chunks: ParsedDiffChunk[]): ParsedDiffChunk[] {
  if (chunks.length <= 1) return chunks;

  const totalTokens = chunks.reduce((acc, c) => acc + c.token_estimate, 0);
  if (totalTokens <= CONFIG.MAX_CHUNK_TOKENS) {
    const combinedContent = chunks
      .map((c) => `# File: ${c.file_path}\n${c.content}`)
      .join("\n\n");

    return [
      {
        index: 0,
        file_path: chunks.map((c) => c.file_path).join(", "),
        content: combinedContent,
        token_estimate: totalTokens,
      },
    ];
  }

  return chunks;
}

async function initializeJobChunks(
  supabase: SupabaseClient,
  jobId: string,
  chunks: ParsedDiffChunk[]
): Promise<void> {
  const rows = chunks.map((chunk, idx) => ({
    job_id: jobId,
    chunk_index: idx,
    file_path: chunk.file_path,
    diff_content: chunk.content,
    status: "pending",
  }));

  await supabase.from("review_chunks").insert(rows);
  await supabase
    .from("review_jobs")
    .update({ total_chunks: chunks.length, completed_chunks: 0 })
    .eq("id", jobId);
}

async function executeChunkReviews(
  supabase: SupabaseClient,
  jobId: string,
  chunks: ParsedDiffChunk[],
  context: ReviewContext,
  deadline: number
): Promise<{ executionResults: ChunkExecutionResult[]; reachedDeadline: boolean }> {
  const concurrency = getConcurrency();
  const chunkTimeoutMs = getChunkTimeoutMs();
  const executionResults: ChunkExecutionResult[] = [];
  let reachedDeadline = false;

  for (let i = 0; i < chunks.length; i += concurrency) {
    if (Date.now() >= deadline) {
      reachedDeadline = true;
      break;
    }

    const batch = chunks.slice(i, i + concurrency);
    const batchPromises = batch.map((chunk) =>
      processSingleChunk(supabase, jobId, chunk, context, chunkTimeoutMs)
    );

    const batchResults = await Promise.all(batchPromises);
    executionResults.push(...batchResults);
  }

  if (executionResults.length < chunks.length) {
    reachedDeadline = true;
  }

  return { executionResults, reachedDeadline };
}

async function processSingleChunk(
  supabase: SupabaseClient,
  jobId: string,
  chunk: ParsedDiffChunk,
  context: ReviewContext,
  timeoutMs: number
): Promise<ChunkExecutionResult> {
  try {
    await incrementUsage(supabase);

    const result = await reviewWithTimeout(chunk, context, timeoutMs);

    await supabase
      .from("review_chunks")
      .update({ status: "completed", review_json: result })
      .eq("job_id", jobId)
      .eq("chunk_index", chunk.index);

    return {
      chunkIndex: chunk.index,
      filePath: chunk.file_path,
      result,
      status: "completed",
    };
  } catch (err: unknown) {
    const isUnavailable = isUnavailableError(err);
    const status = isUnavailable ? "retry_later" : "error";

    await supabase
      .from("review_chunks")
      .update({ status })
      .eq("job_id", jobId)
      .eq("chunk_index", chunk.index);

    return {
      chunkIndex: chunk.index,
      filePath: chunk.file_path,
      result: null,
      status,
    };
  }
}

async function reviewWithTimeout(
  chunk: DiffChunk,
  context: ReviewContext,
  timeoutMs: number
): Promise<ChunkReviewResult> {
  return new Promise<ChunkReviewResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Chunk review timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    reviewChunk(chunk, context)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function incrementUsage(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("increment_daily_api_usage");
  if (error) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: row } = await supabase
      .from("daily_api_usage")
      .select("call_count")
      .eq("usage_date", today)
      .maybeSingle();

    const nextCount = (row?.call_count ?? 0) + 1;
    await supabase.from("daily_api_usage").upsert({
      usage_date: today,
      call_count: nextCount,
      updated_at: new Date().toISOString(),
    });
  }
}

async function finalizeReviewJob(
  supabase: SupabaseClient,
  context: JobContext,
  startTime: number,
  chunks: ParsedDiffChunk[],
  results: ChunkExecutionResult[],
  deadlineHit: boolean
): Promise<void> {
  const completed = results.filter(
    (r): r is ChunkExecutionResult & { result: ChunkReviewResult } =>
      r.status === "completed" && r.result !== null
  );

  await supabase
    .from("review_jobs")
    .update({ completed_chunks: completed.length })
    .eq("id", context.job.id);

  if (deadlineHit) {
    await handlePartialReview(supabase, context, startTime, chunks, completed);
    return;
  }

  const anyFailed = results.some((r) => r.status !== "completed");
  if (anyFailed) {
    await handleJobRetryOrFailure(supabase, context.job);
    return;
  }

  await handleCompletedReview(supabase, context, startTime, chunks, completed);
}

async function handlePartialReview(
  supabase: SupabaseClient,
  context: JobContext,
  startTime: number,
  chunks: ParsedDiffChunk[],
  completed: Array<ChunkExecutionResult & { result: ChunkReviewResult }>
): Promise<void> {
  const completedIndices = new Set(completed.map((c) => c.chunkIndex));
  const unreviewed = chunks
    .filter((c) => !completedIndices.has(c.index))
    .map((c) => c.file_path);

  const merged = mergeChunkResults(
    completed.map((c) => c.result),
    { unreviewedFiles: unreviewed }
  );

  const postResult = await postReviewSafely(
    context,
    chunks,
    merged,
    startTime,
    "partial",
    unreviewed
  );

  await saveReviewRecord(
    supabase,
    context.job,
    startTime,
    merged,
    postResult?.githubReviewId ?? null
  );

  await supabase
    .from("review_jobs")
    .update({
      status: "partial",
      error_message: "Execution timeout limit reached; partial review saved",
    })
    .eq("id", context.job.id);
}

async function handleJobRetryOrFailure(
  supabase: SupabaseClient,
  job: ReviewJob
): Promise<void> {
  const nextRetry = job.retry_count + 1;
  if (nextRetry < CONFIG.MAX_JOB_RETRIES) {
    await supabase
      .from("review_jobs")
      .update({ status: "processing", retry_count: nextRetry })
      .eq("id", job.id);
  } else {
    await supabase
      .from("review_jobs")
      .update({
        status: "error",
        error_message: "Max retries reached with unresolved chunk errors",
      })
      .eq("id", job.id);
  }
}

async function handleCompletedReview(
  supabase: SupabaseClient,
  context: JobContext,
  startTime: number,
  chunks: ParsedDiffChunk[],
  completed: Array<ChunkExecutionResult & { result: ChunkReviewResult }>
): Promise<void> {
  const merged = mergeChunkResults(completed.map((c) => c.result));
  const postResult = await postReviewSafely(
    context,
    chunks,
    merged,
    startTime,
    "completed"
  );

  if (postResult?.skippedClosedPr) {
    await supabase
      .from("review_jobs")
      .update({ status: "skipped" })
      .eq("id", context.job.id);
    return;
  }

  await saveReviewRecord(
    supabase,
    context.job,
    startTime,
    merged,
    postResult?.githubReviewId ?? null
  );

  await supabase
    .from("review_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", context.job.id);
}

async function postReviewSafely(
  context: JobContext,
  chunks: ParsedDiffChunk[],
  merged: FullReviewResult,
  startTime: number,
  jobStatus: ReviewJobStatus | "partial" | "deferred",
  unreviewedFiles?: string[]
): Promise<PostReviewResult | null> {
  try {
    const octokit = getInstallationOctokit(context.installation.installation_id);
    const validLinesByFile = collectValidLines(chunks);
    const durationMs = Date.now() - startTime;

    return await postReviewToGitHub({
      octokit,
      owner: context.repo.owner,
      repo: context.repo.name,
      repoId: context.repo.id,
      prNumber: context.job.pr_number,
      commitSha: context.job.head_sha,
      fullReview: merged,
      reviewDurationMs: durationMs,
      chunkCount: chunks.length,
      validLineNumbersByFile: validLinesByFile,
      jobStatus,
      unreviewedFiles,
    });
  } catch (err: unknown) {
    console.error("[PROCESS_REVIEW] Failed to post review to GitHub:", err);
    return null;
  }
}

function collectValidLines(chunks: ParsedDiffChunk[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const chunk of chunks) {
    const lines = chunk.hunk_line_numbers || chunk.line_numbers;
    if (lines && lines.size > 0) {
      let set = map.get(chunk.file_path);
      if (!set) {
        set = new Set<number>();
        map.set(chunk.file_path, set);
      }
      for (const line of lines) {
        set.add(line);
      }
    }
  }
  return map;
}

async function saveReviewRecord(
  supabase: SupabaseClient,
  job: ReviewJob,
  startTime: number,
  merged: FullReviewResult,
  githubReviewId: number | null = null
): Promise<void> {
  const durationMs = Date.now() - startTime;
  const { data: review } = await supabase
    .from("reviews")
    .insert({
      job_id: job.id,
      repo_id: job.repo_id,
      pr_number: job.pr_number,
      pr_title: job.pr_title,
      pr_author: job.pr_author,
      head_sha: job.head_sha,
      summary: merged.summary,
      risk_score: merged.risk_score,
      severity_counts: merged.severity_counts,
      inline_comment_count: merged.comments.length,
      review_duration_ms: durationMs,
      github_review_id: githubReviewId,
    })
    .select("id")
    .single();

  if (review && merged.comments.length > 0) {
    const commentsToInsert = merged.comments.map((c) => ({
      review_id: review.id,
      file_path: c.file_path,
      line_number: c.line_number,
      side: "RIGHT" as const,
      severity: c.severity,
      title: c.title,
      body: c.body,
      suggestion: c.suggestion || null,
    }));
    await supabase.from("review_comments").insert(commentsToInsert);
  }
}

async function finalizeEmptyDiffJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<void> {
  await supabase
    .from("review_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      total_chunks: 0,
      completed_chunks: 0,
    })
    .eq("id", jobId);
}

function getDeadlineMs(): number {
  return process.env.CRON_TIMEOUT_MS
    ? parseInt(process.env.CRON_TIMEOUT_MS, 10)
    : CONFIG.CRON_TIMEOUT_MS;
}

function getConcurrency(): number {
  return process.env.GEMINI_CONCURRENCY
    ? parseInt(process.env.GEMINI_CONCURRENCY, 10)
    : 2;
}

function getChunkTimeoutMs(): number {
  return process.env.GEMINI_CHUNK_TIMEOUT_MS
    ? parseInt(process.env.GEMINI_CHUNK_TIMEOUT_MS, 10)
    : 90_000;
}
