import {
  AIInlineComment,
  ChunkReviewResult,
  FullReviewResult,
  FullReviewResultSchema,
  Severity,
  SeverityCounts,
} from "@/types";

export interface MergeChunkOptions {
  unreviewedFiles?: string[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
  praise: 3,
};

const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 25,
  warning: 10,
  suggestion: 3,
  praise: 0,
};

/**
 * Merges review results from multiple chunks into a unified FullReviewResult.
 * Deduplicates overlapping comments, sorts strictly by severity,
 * and computes overall risk score.
 */
export function mergeChunkResults(
  chunks: ChunkReviewResult[],
  options?: MergeChunkOptions
): FullReviewResult {
  const deduplicatedComments = deduplicateAndSortComments(chunks);
  const severityCounts = countSeverities(deduplicatedComments);
  const riskScore = computeRiskScore(severityCounts);
  const summary = assembleSummary(chunks, options?.unreviewedFiles);

  const result: FullReviewResult = {
    summary,
    risk_score: riskScore,
    severity_counts: severityCounts,
    comments: deduplicatedComments,
  };

  return FullReviewResultSchema.parse(result);
}

function deduplicateAndSortComments(chunks: ChunkReviewResult[]): AIInlineComment[] {
  const seen = new Set<string>();
  const uniqueComments: AIInlineComment[] = [];

  for (const chunk of chunks) {
    for (const comment of chunk.comments) {
      const key = `${comment.file_path}:${comment.line_number}:${comment.title.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueComments.push(comment);
      }
    }
  }

  return uniqueComments.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const fileDiff = a.file_path.localeCompare(b.file_path);
    if (fileDiff !== 0) return fileDiff;
    return a.line_number - b.line_number;
  });
}

function countSeverities(comments: AIInlineComment[]): SeverityCounts {
  const counts: SeverityCounts = {
    critical: 0,
    warning: 0,
    suggestion: 0,
    praise: 0,
  };

  for (const comment of comments) {
    counts[comment.severity]++;
  }

  return counts;
}

function computeRiskScore(counts: SeverityCounts): number {
  const rawScore =
    counts.critical * SEVERITY_WEIGHTS.critical +
    counts.warning * SEVERITY_WEIGHTS.warning +
    counts.suggestion * SEVERITY_WEIGHTS.suggestion;

  return Math.min(100, Math.max(0, rawScore));
}

function assembleSummary(
  chunks: ChunkReviewResult[],
  unreviewedFiles?: string[]
): string {
  const summaries = chunks
    .map((c) => c.chunk_summary.trim())
    .filter((s) => s.length > 0);

  let combined = summaries.length > 0
    ? summaries.join("\n\n")
    : "Review completed. No specific issues identified.";

  if (unreviewedFiles && unreviewedFiles.length > 0) {
    const note = `\n\nNote: The following unreviewed files were omitted due to limits: ${unreviewedFiles.join(", ")}`;
    combined += note;
  }

  if (combined.length > 2000) {
    return combined.slice(0, 1997) + "...";
  }

  return combined;
}
