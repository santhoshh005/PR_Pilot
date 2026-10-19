import { z } from "zod";

// ============================================================
// Database row types (mirror schema.sql)
// ============================================================

export interface Profile {
  id: string; // UUID, matches auth.users.id
  github_user_id: number;
  github_username: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Installation {
  id: string;
  installation_id: number; // GitHub's numeric installation ID
  owner_id: string;
  account_login: string;
  account_type: "User" | "Organization";
  created_at: string;
  suspended_at: string | null;
}

export interface Repo {
  id: string;
  installation_id: string;
  github_repo_id: number;
  owner: string;
  name: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Strictness = "relaxed" | "balanced" | "strict";

export interface RepoSettings {
  id: string;
  repo_id: string;
  ignored_paths: string[];
  strictness: Strictness;
  custom_instructions: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  delivery_id: string;
  event: string;
  action: string;
  received_at: string;
}

export type ReviewJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "error"
  | "skipped";

export interface ReviewJob {
  id: string;
  repo_id: string;
  pr_number: number;
  pr_title: string;
  pr_author: string;
  head_sha: string;
  base_sha: string;
  delivery_id: string;
  status: ReviewJobStatus;
  retry_count: number;
  error_message: string | null;
  total_chunks: number | null;
  completed_chunks: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type ChunkStatus = "pending" | "processing" | "completed" | "error";

export interface ReviewChunk {
  id: string;
  job_id: string;
  chunk_index: number;
  file_path: string;
  diff_content: string;
  review_json: ChunkReviewResult | null;
  status: ChunkStatus;
  created_at: string;
}

export interface Review {
  id: string;
  job_id: string;
  repo_id: string;
  pr_number: number;
  pr_title: string;
  pr_author: string;
  head_sha: string;
  summary: string;
  risk_score: number; // 0-100
  severity_counts: SeverityCounts;
  inline_comment_count: number;
  review_duration_ms: number;
  github_review_id: number | null;
  created_at: string;
}

export interface ReviewComment {
  id: string;
  review_id: string;
  file_path: string;
  line_number: number | null;
  side: "LEFT" | "RIGHT"; // AI schema omits side; posting always defaults side to "RIGHT"
  severity: Severity;
  title: string;
  body: string;
  suggestion: string | null;
  created_at: string;
}

// ============================================================
// Enums & shared types
// ============================================================

export type Severity = "critical" | "warning" | "suggestion" | "praise";

export interface SeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
  praise: number;
}

// ============================================================
// Zod schemas: AI review response
// ============================================================

/** Severity enum as Zod */
export const SeveritySchema = z.enum([
  "critical",
  "warning",
  "suggestion",
  "praise",
]);

/** Single inline comment from the AI */
export const AIInlineCommentSchema = z.object({
  file_path: z.string().describe("Relative path of the file in the repo"),
  line_number: z
    .number()
    .int()
    .positive()
    .describe("Line number in the new (right) side of the diff"),
  severity: SeveritySchema,
  title: z
    .string()
    .max(120)
    .describe("One-line summary of the finding"),
  body: z
    .string()
    .max(1000)
    .describe("Detailed explanation of the issue and why it matters"),
  suggestion: z
    .string()
    .max(500)
    .optional()
    .describe("Suggested replacement code, if applicable"),
});

export type AIInlineComment = z.infer<typeof AIInlineCommentSchema>;

/** The structured JSON the AI must return for each diff chunk */
export const ChunkReviewResultSchema = z.object({
  chunk_summary: z
    .string()
    .max(500)
    .describe("Brief summary of what this chunk of code does"),
  comments: z
    .array(AIInlineCommentSchema)
    .max(20)
    .describe("Inline review comments for this chunk"),
  severity_counts: z.object({
    critical: z.number().int().min(0),
    warning: z.number().int().min(0),
    suggestion: z.number().int().min(0),
    praise: z.number().int().min(0),
  }),
});

export type ChunkReviewResult = z.infer<typeof ChunkReviewResultSchema>;

/** Merged review across all chunks — assembled by the processor, not the AI */
export const FullReviewResultSchema = z.object({
  summary: z
    .string()
    .max(2000)
    .describe("Overall PR summary combining all chunk summaries"),
  risk_score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Computed risk score: 0 = safe, 100 = dangerous"),
  severity_counts: z.object({
    critical: z.number().int().min(0),
    warning: z.number().int().min(0),
    suggestion: z.number().int().min(0),
    praise: z.number().int().min(0),
  }),
  comments: z.array(AIInlineCommentSchema),
});

export type FullReviewResult = z.infer<typeof FullReviewResultSchema>;

// ============================================================
// Zod schemas: Repo settings (for API validation)
// ============================================================

export const StrictnessSchema = z.enum(["relaxed", "balanced", "strict"]);

export const RepoSettingsUpdateSchema = z.object({
  ignored_paths: z.array(z.string().max(500)).max(50).optional(),
  strictness: StrictnessSchema.optional(),
  custom_instructions: z.string().max(2000).optional(),
});

export type RepoSettingsUpdate = z.infer<typeof RepoSettingsUpdateSchema>;

// ============================================================
// Zod schemas: Webhook payloads (subset we use)
// ============================================================

export const WebhookPullRequestSchema = z.object({
  action: z.enum(["opened", "synchronize", "reopened"]),
  number: z.number().int(),
  pull_request: z.object({
    title: z.string(),
    user: z.object({
      login: z.string(),
    }),
    head: z.object({
      sha: z.string(),
    }),
    base: z.object({
      sha: z.string(),
    }),
    state: z.enum(["open", "closed"]),
  }),
  repository: z.object({
    id: z.number(),
    full_name: z.string(),
  }),
  installation: z
    .object({
      id: z.number(),
    })
    .optional(),
});

export type WebhookPullRequest = z.infer<typeof WebhookPullRequestSchema>;

// ============================================================
// API response shapes
// ============================================================

/** Standard API error */
export interface ApiError {
  error: string;
  message: string;
  status: number;
}

/** Dashboard: repo list item */
export interface DashboardRepo {
  id: string;
  full_name: string;
  owner: string;
  name: string;
  is_active: boolean;
  total_reviews: number;
  avg_risk_score: number | null;
  last_review_at: string | null;
}

/** Dashboard: review history item */
export interface ReviewHistoryItem {
  id: string;
  pr_number: number;
  pr_title: string;
  pr_author: string;
  head_sha: string;
  risk_score: number;
  severity_counts: SeverityCounts;
  inline_comment_count: number;
  review_duration_ms: number;
  created_at: string;
}

/** Dashboard: severity breakdown (for charts) */
export interface SeverityBreakdown {
  date: string; // ISO date (YYYY-MM-DD)
  critical: number;
  warning: number;
  suggestion: number;
  praise: number;
}

/** Dashboard: risk score trend point */
export interface RiskScoreTrend {
  date: string;
  avg_risk_score: number;
  review_count: number;
}

/** Dashboard: aggregated repo stats response */
export interface RepoStatsResponse {
  severity_breakdown: SeverityBreakdown[];
  risk_trend: RiskScoreTrend[];
  total_reviews: number;
  avg_review_duration_ms: number;
}

/** Installation sync endpoint response */
export interface InstallationSyncResponse {
  installations: number;
  repos: number;
}

// ============================================================
// Diff parsing types
// ============================================================

export interface DiffChunk {
  index: number;
  file_path: string;
  content: string;
  token_estimate: number; // rough: chars / 4
}

export interface ParsedDiff {
  files: DiffFile[];
  total_additions: number;
  total_deletions: number;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  content: string;
}

// ============================================================
// Config constants
// ============================================================

export const CONFIG = {
  /** Max tokens per diff chunk sent to Gemini */
  MAX_CHUNK_TOKENS: 6000,
  /** Max chunks processed per cron invocation */
  MAX_CHUNKS_PER_INVOCATION: 3,
  /** Max retries for a failed review job */
  MAX_JOB_RETRIES: 5,
  /** Hard deadline budget in ms (250s of 300s limit) */
  CRON_TIMEOUT_MS: 250_000,
  /** Gemini model name */
  GEMINI_MODEL: "gemini-3.8-flash" as const,
  /** Max inline comments per chunk */
  MAX_COMMENTS_PER_CHUNK: 20,
} as const;
