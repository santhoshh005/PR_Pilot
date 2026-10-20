import { Octokit } from "@octokit/rest";
import {
  AIInlineComment,
  CONFIG,
  FullReviewResult,
  ReviewJobStatus,
  Severity,
} from "@/types";

export interface PostReviewParams {
  octokit: Octokit;
  owner: string;
  repo: string;
  repoId: string;
  prNumber: number;
  commitSha: string;
  fullReview: FullReviewResult;
  reviewDurationMs: number;
  chunkCount: number;
  validLineNumbersByFile?: Map<string, Set<number>>;
  jobStatus?: ReviewJobStatus | "partial" | "deferred";
  unreviewedFiles?: string[];
  maxInlineComments?: number;
  alreadyReviewedSha?: boolean;
}

export interface PostReviewResult {
  githubReviewId: number | null;
  updatedExistingComment: boolean;
  inlineCommentsPosted: number;
  inlineCommentsDropped: number;
  omittedComments: number;
  fallbackToSummaryOnly: boolean;
  skippedClosedPr?: boolean;
  skippedAlreadyReviewed?: boolean;
}

export interface GitHubReviewCommentPayload {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

const SEVERITY_EMOJIS: Record<Severity, string> = {
  critical: "🔴",
  warning: "🟡",
  suggestion: "🔵",
  praise: "🟢",
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
  praise: 3,
};

/**
 * Posts or updates a GitHub PR review with summary and inline comments.
 */
export async function postReviewToGitHub(
  params: PostReviewParams
): Promise<PostReviewResult> {
  const { octokit, owner, repo, repoId, prNumber, commitSha } = params;

  if (params.alreadyReviewedSha) {
    return createSkippedResult({ skippedAlreadyReviewed: true });
  }

  const isOpen = await checkPrIsOpen(octokit, owner, repo, prNumber);
  if (!isOpen) {
    return createSkippedResult({ skippedClosedPr: true });
  }

  const { summaryBody, formattedComments, inlineCount, otherNotesCount, omittedCount } =
    prepareReviewPayload(params);

  const existingReviewId = await findExistingReviewId(octokit, owner, repo, prNumber, repoId);

  if (existingReviewId) {
    return handleExistingReviewUpdate(
      octokit,
      owner,
      repo,
      prNumber,
      commitSha,
      existingReviewId,
      summaryBody,
      formattedComments,
      inlineCount,
      otherNotesCount,
      omittedCount
    );
  }

  return submitNewReview(
    octokit,
    owner,
    repo,
    prNumber,
    commitSha,
    summaryBody,
    formattedComments,
    inlineCount,
    otherNotesCount,
    omittedCount
  );
}

function prepareReviewPayload(params: PostReviewParams) {
  const { inlineComments, otherNotes, omittedCount } = filterAndCapComments(params);
  const formattedComments = formatInlineComments(inlineComments);
  const summaryBody = buildReviewSummaryBody({
    repoId: params.repoId,
    fullReview: params.fullReview,
    reviewDurationMs: params.reviewDurationMs,
    chunkCount: params.chunkCount,
    otherNotes,
    omittedCommentsCount: omittedCount,
    unreviewedFiles: params.unreviewedFiles,
    jobStatus: params.jobStatus,
  });

  return {
    summaryBody,
    formattedComments,
    inlineCount: inlineComments.length,
    otherNotesCount: otherNotes.length,
    omittedCount,
  };
}

function createSkippedResult(
  flags: { skippedClosedPr?: boolean; skippedAlreadyReviewed?: boolean }
): PostReviewResult {
  return {
    githubReviewId: null,
    updatedExistingComment: false,
    inlineCommentsPosted: 0,
    inlineCommentsDropped: 0,
    omittedComments: 0,
    fallbackToSummaryOnly: false,
    ...flags,
  };
}

async function checkPrIsOpen(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<boolean> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return pr.state === "open" && !pr.merged;
}

function filterAndCapComments(params: PostReviewParams) {
  const cap =
    params.maxInlineComments ??
    (process.env.MAX_INLINE_COMMENTS
      ? parseInt(process.env.MAX_INLINE_COMMENTS, 10)
      : CONFIG.MAX_COMMENTS_PER_CHUNK);

  return validateAndFilterComments(
    params.fullReview.comments,
    params.validLineNumbersByFile,
    cap
  );
}

async function findExistingReviewId(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  repoId: string
): Promise<number | null> {
  const marker = `<!-- prpilot:repo:${repoId} -->`;
  const { data: reviews } = await octokit.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });

  for (const r of reviews) {
    if (r.body && r.body.includes(marker)) {
      return r.id;
    }
  }

  return null;
}

async function handleExistingReviewUpdate(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  existingReviewId: number,
  summaryBody: string,
  formattedComments: GitHubReviewCommentPayload[],
  inlinePosted: number,
  inlineDropped: number,
  omittedCount: number
): Promise<PostReviewResult> {
  await octokit.rest.pulls.updateReview({
    owner,
    repo,
    pull_number: prNumber,
    review_id: existingReviewId,
    body: summaryBody,
  });

  if (formattedComments.length > 0) {
    await submitInlineCommentsOnly(
      octokit,
      owner,
      repo,
      prNumber,
      commitSha,
      formattedComments
    );
  }

  return {
    githubReviewId: existingReviewId,
    updatedExistingComment: true,
    inlineCommentsPosted: inlinePosted,
    inlineCommentsDropped: inlineDropped,
    omittedComments: omittedCount,
    fallbackToSummaryOnly: false,
  };
}

async function submitInlineCommentsOnly(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  comments: GitHubReviewCommentPayload[]
): Promise<void> {
  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitSha,
      event: "COMMENT",
      comments,
    });
  } catch {
    // Graceful fallback: inline comments for new commit may be out-of-date or 422
  }
}

async function submitNewReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  summaryBody: string,
  formattedComments: GitHubReviewCommentPayload[],
  inlinePosted: number,
  inlineDropped: number,
  omittedCount: number
): Promise<PostReviewResult> {
  try {
    const { data: review } = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitSha,
      event: "COMMENT",
      body: summaryBody,
      comments: formattedComments.length > 0 ? formattedComments : undefined,
    });

    return {
      githubReviewId: review.id,
      updatedExistingComment: false,
      inlineCommentsPosted: inlinePosted,
      inlineCommentsDropped: inlineDropped,
      omittedComments: omittedCount,
      fallbackToSummaryOnly: false,
    };
  } catch (err: unknown) {
    if (is422Error(err)) {
      return fallbackPostSummaryOnly(
        octokit,
        owner,
        repo,
        prNumber,
        summaryBody,
        inlineDropped + inlinePosted,
        omittedCount
      );
    }
    throw err;
  }
}

async function fallbackPostSummaryOnly(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  summaryBody: string,
  droppedCount: number,
  omittedCount: number
): Promise<PostReviewResult> {
  const fallbackNote =
    "\n\n> ⚠️ *Note: Inline comments could not be attached due to GitHub 422 validation error (e.g. diff changed or stale commit).*";

  const { data: review } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event: "COMMENT",
    body: summaryBody + fallbackNote,
  });

  return {
    githubReviewId: review.id,
    updatedExistingComment: false,
    inlineCommentsPosted: 0,
    inlineCommentsDropped: droppedCount,
    omittedComments: omittedCount,
    fallbackToSummaryOnly: true,
  };
}

function is422Error(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  const message = (err as { message?: string }).message?.toLowerCase() || "";
  return status === 422 || message.includes("422") || message.includes("unprocessable");
}

export function validateAndFilterComments(
  comments: AIInlineComment[],
  validLinesByFile?: Map<string, Set<number>>,
  maxComments?: number
): {
  inlineComments: AIInlineComment[];
  otherNotes: string[];
  omittedCount: number;
} {
  const inlineCandidates: AIInlineComment[] = [];
  const otherNotes: string[] = [];

  for (const comment of comments) {
    const isLineValid = checkLineInDiff(comment, validLinesByFile);
    if (isLineValid) {
      inlineCandidates.push(comment);
    } else {
      otherNotes.push(
        `- **${comment.file_path}** (line ${comment.line_number ?? "N/A"}): ${sanitizeText(comment.title)} — ${sanitizeText(comment.body)}`
      );
    }
  }

  inlineCandidates.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  const cap = maxComments ?? inlineCandidates.length;
  const inlineComments = inlineCandidates.slice(0, cap);
  const omittedCount = Math.max(0, inlineCandidates.length - cap);

  return { inlineComments, otherNotes, omittedCount };
}

function checkLineInDiff(
  comment: AIInlineComment,
  validLinesByFile?: Map<string, Set<number>>
): boolean {
  if (!validLinesByFile) return true;
  if (!comment.line_number || comment.line_number <= 0) return false;

  const validLines = validLinesByFile.get(comment.file_path);
  if (!validLines) return false;

  return validLines.has(comment.line_number);
}

export function formatInlineComments(
  comments: AIInlineComment[]
): GitHubReviewCommentPayload[] {
  return comments.map((comment) => {
    const emoji = SEVERITY_EMOJIS[comment.severity] || "🔵";
    const cleanTitle = sanitizeText(comment.title).slice(0, 120);
    const cleanBody = sanitizeText(comment.body).slice(0, 1000);

    let body = `### ${emoji} ${cleanTitle}\n\n${cleanBody}`;

    if (comment.suggestion && comment.suggestion.trim().length > 0) {
      const cleanSuggestion = sanitizeSuggestion(comment.suggestion);
      body += `\n\n\`\`\`suggestion\n${cleanSuggestion}\n\`\`\``;
    }

    return {
      path: comment.file_path,
      line: comment.line_number,
      side: "RIGHT",
      body,
    };
  });
}

export function sanitizeText(text: string): string {
  if (!text) return "";
  let sanitized = text;

  // Neutralise @mentions and team mentions
  sanitized = sanitized.replace(/@([a-zA-Z0-9_\-\/]+)/g, "@ $1");

  // Strip raw HTML tags (except HTML comments)
  sanitized = sanitized.replace(/<(?!!--)[^>]+>/g, "");

  // Strip image markdown: ![alt](url) -> ""
  sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Strip markdown link URLs: [text](url) -> text
  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  return sanitized;
}

function sanitizeSuggestion(code: string): string {
  return code
    .replace(/@([a-zA-Z0-9_\-\/]+)/g, "@ $1")
    .slice(0, 500)
    .trim();
}

export function buildReviewSummaryBody(params: {
  repoId: string;
  fullReview: FullReviewResult;
  reviewDurationMs: number;
  chunkCount: number;
  otherNotes: string[];
  omittedCommentsCount: number;
  unreviewedFiles?: string[];
  jobStatus?: ReviewJobStatus | "partial" | "deferred";
}): string {
  const {
    repoId,
    fullReview,
    reviewDurationMs,
    chunkCount,
    otherNotes,
    omittedCommentsCount,
    unreviewedFiles,
    jobStatus,
  } = params;

  const durationSec = Math.round(reviewDurationMs / 1000);
  const score = fullReview.risk_score;
  const label = getRiskLabel(score);

  let body = `<!-- prpilot:repo:${repoId} -->\n## 🤖 PRPilot Review\n\n**Risk Score: ${score}/100** ${label}\n\n### Summary\n${sanitizeText(fullReview.summary)}\n\n${renderFindingsTable(fullReview)}`;

  if (fullReview.severity_counts.critical > 0) {
    body += `\n> ⚠️ **Critical issues found.** Please address them before merging.\n`;
  }

  if (unreviewedFiles && unreviewedFiles.length > 0) {
    body += `\n${renderUnreviewedFiles(unreviewedFiles, jobStatus)}\n`;
  }

  if (otherNotes.length > 0) {
    body += `\n### Other notes\n${otherNotes.join("\n")}\n`;
  }

  if (omittedCommentsCount > 0) {
    body += `\n<sub>Note: ${omittedCommentsCount} inline comment(s) omitted due to per-review limit.</sub>\n`;
  }

  body += `\n---\n<sub>Reviewed by [PRPilot](https://github.com/apps/prpilot) • ${durationSec}s • ${chunkCount} chunk(s) analyzed</sub>`;

  return body;
}

function renderFindingsTable(fullReview: FullReviewResult): string {
  return `### Findings\n| Severity | Count |\n|---|---|\n| 🔴 Critical | ${fullReview.severity_counts.critical} |\n| 🟡 Warning | ${fullReview.severity_counts.warning} |\n| 🔵 Suggestion | ${fullReview.severity_counts.suggestion} |\n| 🟢 Praise | ${fullReview.severity_counts.praise} |\n`;
}

function renderUnreviewedFiles(
  files: string[],
  jobStatus?: ReviewJobStatus | "partial" | "deferred"
): string {
  const reason = jobStatus === "partial" ? "timeout budget limits" : "daily API budget limits";
  const list = files.map((f) => `- ${f}`).join("\n");
  return `### Unreviewed Files\nDue to ${reason}, the following files could not be reviewed:\n${list}`;
}

function getRiskLabel(score: number): string {
  if (score <= 20) return "Low risk";
  if (score <= 50) return "Moderate risk";
  if (score <= 80) return "High risk";
  return "Critical risk";
}
