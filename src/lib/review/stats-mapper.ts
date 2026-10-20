import { SeverityBreakdown, RiskScoreTrend } from "@/types";

export const DEFAULT_STATS_DAYS = 30;
export const MAX_STATS_DAYS = 90;
export const MAX_STATS_ROWS = 1000;

/**
 * Returns ISO string cutoff for stats lookback window.
 */
export function getStatsLookbackCutoff(days: number = DEFAULT_STATS_DAYS): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export interface ReviewStatsSource {
  id?: string;
  risk_score?: number | null;
  severity_counts?: {
    critical?: number | null;
    warning?: number | null;
    suggestion?: number | null;
    praise?: number | null;
  } | null;
  review_duration_ms?: number | null;
  created_at: string;
}

export interface MappedStatsResult {
  severityBreakdown: SeverityBreakdown[];
  riskTrend: RiskScoreTrend[];
  totalReviews: number;
  avgReviewDurationMs: number;
}

/**
 * Extracts and sanitizes a YYYY-MM-DD date key from an ISO timestamp string.
 * Strips HTML tags or non-date characters to ensure safe plain-text rendering.
 */
function sanitizeDateKey(rawDate: string): string {
  if (!rawDate) return "";
  // Strip any HTML tags or script tokens
  const clean = rawDate.replace(/<[^>]*>/g, "").trim();
  // Match standard YYYY-MM-DD prefix
  const match = clean.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  return clean.slice(0, 10);
}

/**
 * Groups review records into chronological daily buckets for severity breakdown
 * and risk score trend charts.
 */
export function mapReviewsToDailyStats(
  reviews: ReviewStatsSource[],
  days = 30
): MappedStatsResult {
  void days;
  const totalReviews = reviews.length;
  if (totalReviews === 0) {
    return {
      severityBreakdown: [],
      riskTrend: [],
      totalReviews: 0,
      avgReviewDurationMs: 0,
    };
  }

  let totalDuration = 0;
  let durationCount = 0;

  const dailyMap = new Map<
    string,
    {
      critical: number;
      warning: number;
      suggestion: number;
      praise: number;
      riskScores: number[];
      reviewCount: number;
    }
  >();

  for (const r of reviews) {
    if (typeof r.review_duration_ms === "number" && !isNaN(r.review_duration_ms)) {
      totalDuration += r.review_duration_ms;
      durationCount++;
    }

    const dateKey = sanitizeDateKey(r.created_at);
    if (!dateKey) continue;

    const current = dailyMap.get(dateKey) || {
      critical: 0,
      warning: 0,
      suggestion: 0,
      praise: 0,
      riskScores: [],
      reviewCount: 0,
    };

    current.reviewCount++;

    const counts = r.severity_counts || {};
    current.critical += Number(counts.critical) || 0;
    current.warning += Number(counts.warning) || 0;
    current.suggestion += Number(counts.suggestion) || 0;
    current.praise += Number(counts.praise) || 0;

    if (typeof r.risk_score === "number" && !isNaN(r.risk_score)) {
      current.riskScores.push(r.risk_score);
    }

    dailyMap.set(dateKey, current);
  }

  const severityBreakdown: SeverityBreakdown[] = [];
  const riskTrend: RiskScoreTrend[] = [];

  const sortedDates = Array.from(dailyMap.keys()).sort();

  for (const d of sortedDates) {
    const stats = dailyMap.get(d)!;

    severityBreakdown.push({
      date: d,
      critical: stats.critical,
      warning: stats.warning,
      suggestion: stats.suggestion,
      praise: stats.praise,
    });

    const avgRisk =
      stats.riskScores.length > 0
        ? Math.round(
            stats.riskScores.reduce((sum, score) => sum + score, 0) /
              stats.riskScores.length
          )
        : 0;

    riskTrend.push({
      date: d,
      avg_risk_score: avgRisk,
      review_count: stats.reviewCount,
    });
  }

  const avgReviewDurationMs =
    durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;

  return {
    severityBreakdown,
    riskTrend,
    totalReviews,
    avgReviewDurationMs,
  };
}
