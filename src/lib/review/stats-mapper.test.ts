import { describe, it, expect } from "vitest";
import { mapReviewsToDailyStats } from "./stats-mapper";

describe("mapReviewsToDailyStats", () => {
  it("handles empty reviews array returning empty severity and risk data", () => {
    const result = mapReviewsToDailyStats([], 30);
    expect(result.severityBreakdown).toEqual([]);
    expect(result.riskTrend).toEqual([]);
    expect(result.totalReviews).toBe(0);
    expect(result.avgReviewDurationMs).toBe(0);
  });

  it("correctly groups multiple reviews on the same day and calculates averages and severity counts", () => {
    const reviews = [
      {
        id: "rev-1",
        risk_score: 40,
        severity_counts: { critical: 1, warning: 2, suggestion: 0, praise: 1 },
        review_duration_ms: 1000,
        created_at: "2026-10-18T10:00:00Z",
      },
      {
        id: "rev-2",
        risk_score: 80,
        severity_counts: { critical: 2, warning: 1, suggestion: 3, praise: 0 },
        review_duration_ms: 2000,
        created_at: "2026-10-18T14:30:00Z",
      },
      {
        id: "rev-3",
        risk_score: 30,
        severity_counts: { critical: 0, warning: 1, suggestion: 1, praise: 2 },
        review_duration_ms: 1500,
        created_at: "2026-10-19T09:00:00Z",
      },
    ];

    const result = mapReviewsToDailyStats(reviews, 30);

    expect(result.totalReviews).toBe(3);
    expect(result.avgReviewDurationMs).toBe(1500); // (1000 + 2000 + 1500) / 3

    // 2026-10-18
    expect(result.severityBreakdown[0]).toEqual({
      date: "2026-10-18",
      critical: 3,
      warning: 3,
      suggestion: 3,
      praise: 1,
    });
    expect(result.riskTrend[0]).toEqual({
      date: "2026-10-18",
      avg_risk_score: 60, // (40 + 80) / 2
      review_count: 2,
    });

    // 2026-10-19
    expect(result.severityBreakdown[1]).toEqual({
      date: "2026-10-19",
      critical: 0,
      warning: 1,
      suggestion: 1,
      praise: 2,
    });
    expect(result.riskTrend[1]).toEqual({
      date: "2026-10-19",
      avg_risk_score: 30,
      review_count: 1,
    });
  });

  it("handles missing/null/undefined counts and duration safely without NaN", () => {
    const reviews = [
      {
        id: "rev-nulls",
        risk_score: null,
        severity_counts: null,
        review_duration_ms: null,
        created_at: "2026-10-15T00:00:00Z",
      },
    ];

    const result = mapReviewsToDailyStats(reviews as any, 30);

    expect(result.totalReviews).toBe(1);
    expect(result.avgReviewDurationMs).toBe(0);
    expect(result.severityBreakdown[0]).toEqual({
      date: "2026-10-15",
      critical: 0,
      warning: 0,
      suggestion: 0,
      praise: 0,
    });
    expect(result.riskTrend[0]).toEqual({
      date: "2026-10-15",
      avg_risk_score: 0,
      review_count: 1,
    });
  });

  it("escapes hostile strings in date or tags and outputs clean plain text dates", () => {
    const reviews = [
      {
        id: "rev-xss",
        risk_score: 50,
        severity_counts: { critical: 1 },
        review_duration_ms: 100,
        created_at: "<script>alert(1)</script>2026-10-12",
      },
    ];

    const result = mapReviewsToDailyStats(reviews, 30);
    expect(result.severityBreakdown[0].date).not.toContain("<script>");
  });
});
