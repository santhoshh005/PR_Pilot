import { describe, it, expect } from "vitest";
import { mergeChunkResults } from "./merger";
import { ChunkReviewResult, FullReviewResultSchema } from "@/types";

describe("mergeChunkResults", () => {
  it("sums severity counts and calculates risk score according to PROMPTS.md formula", () => {
    const chunk1: ChunkReviewResult = {
      chunk_summary: "Reviewed authentication logic.",
      comments: [
        {
          file_path: "src/auth.ts",
          line_number: 10,
          severity: "critical",
          title: "SQL Injection",
          body: "Untrusted input in query",
        },
        {
          file_path: "src/auth.ts",
          line_number: 25,
          severity: "warning",
          title: "Missing null check",
          body: "Object might be undefined",
        },
      ],
      severity_counts: { critical: 1, warning: 1, suggestion: 0, praise: 0 },
    };

    const chunk2: ChunkReviewResult = {
      chunk_summary: "Reviewed user profile route.",
      comments: [
        {
          file_path: "src/profile.ts",
          line_number: 15,
          severity: "suggestion",
          title: "Use const instead of let",
          body: "Variable is never reassigned",
        },
        {
          file_path: "src/profile.ts",
          line_number: 40,
          severity: "praise",
          title: "Clean abstraction",
          body: "Good separation of concerns",
        },
      ],
      severity_counts: { critical: 0, warning: 0, suggestion: 1, praise: 1 },
    };

    const merged = mergeChunkResults([chunk1, chunk2]);

    expect(merged.severity_counts).toEqual({
      critical: 1,
      warning: 1,
      suggestion: 1,
      praise: 1,
    });

    // 1*25 + 1*10 + 1*3 + 1*0 = 38
    expect(merged.risk_score).toBe(38);
    expect(merged.summary).toContain("Reviewed authentication logic.");
    expect(merged.summary).toContain("Reviewed user profile route.");
    expect(FullReviewResultSchema.safeParse(merged).success).toBe(true);
  });

  it("caps risk score at 100 for high-severity changes", () => {
    const dangerousChunk: ChunkReviewResult = {
      chunk_summary: "Multiple security holes.",
      comments: [
        { file_path: "a.ts", line_number: 1, severity: "critical", title: "C1", body: "B" },
        { file_path: "a.ts", line_number: 2, severity: "critical", title: "C2", body: "B" },
        { file_path: "a.ts", line_number: 3, severity: "critical", title: "C3", body: "B" },
        { file_path: "a.ts", line_number: 4, severity: "critical", title: "C4", body: "B" },
        { file_path: "a.ts", line_number: 5, severity: "critical", title: "C5", body: "B" },
      ],
      severity_counts: { critical: 5, warning: 0, suggestion: 0, praise: 0 },
    };

    // 5 * 25 = 125 -> capped at 100
    const merged = mergeChunkResults([dangerousChunk]);
    expect(merged.risk_score).toBe(100);
  });

  it("sorts comments strictly by severity ordering: critical -> warning -> suggestion -> praise", () => {
    const chunk: ChunkReviewResult = {
      chunk_summary: "Mixed findings.",
      comments: [
        { file_path: "z.ts", line_number: 10, severity: "praise", title: "Nice code", body: "Good" },
        { file_path: "a.ts", line_number: 5, severity: "warning", title: "Slow query", body: "Perf" },
        { file_path: "b.ts", line_number: 12, severity: "suggestion", title: "Format", body: "Style" },
        { file_path: "c.ts", line_number: 1, severity: "critical", title: "Crash", body: "Exception" },
      ],
      severity_counts: { critical: 1, warning: 1, suggestion: 1, praise: 1 },
    };

    const merged = mergeChunkResults([chunk]);
    const severities = merged.comments.map((c) => c.severity);
    expect(severities).toEqual(["critical", "warning", "suggestion", "praise"]);
  });

  it("deduplicates identical comments on the same file and line", () => {
    const chunk1: ChunkReviewResult = {
      chunk_summary: "Chunk 1 summary.",
      comments: [
        {
          file_path: "src/index.ts",
          line_number: 42,
          severity: "warning",
          title: "Unhandled rejection",
          body: "Promise is not caught",
        },
      ],
      severity_counts: { critical: 0, warning: 1, suggestion: 0, praise: 0 },
    };

    const chunk2: ChunkReviewResult = {
      chunk_summary: "Chunk 2 summary (boundary overlap).",
      comments: [
        {
          file_path: "src/index.ts",
          line_number: 42,
          severity: "warning",
          title: "Unhandled rejection",
          body: "Promise is not caught",
        },
        {
          file_path: "src/other.ts",
          line_number: 10,
          severity: "suggestion",
          title: "Add type annotation",
          body: "Explicit return type helps",
        },
      ],
      severity_counts: { critical: 0, warning: 1, suggestion: 1, praise: 0 },
    };

    const merged = mergeChunkResults([chunk1, chunk2]);
    expect(merged.comments.length).toBe(2);
    expect(merged.severity_counts).toEqual({
      critical: 0,
      warning: 1,
      suggestion: 1,
      praise: 0,
    });
    expect(merged.risk_score).toBe(13); // 1*10 + 1*3
  });

  it("appends unreviewed files note and limits summary to 2000 chars", () => {
    const longSummary = "A".repeat(1950);
    const chunk: ChunkReviewResult = {
      chunk_summary: longSummary,
      comments: [],
      severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
    };

    const merged = mergeChunkResults([chunk], {
      unreviewedFiles: ["src/large1.ts", "src/large2.ts"],
    });

    expect(merged.summary.length).toBeLessThanOrEqual(2000);
    expect(merged.summary).toContain("unreviewed");
    expect(FullReviewResultSchema.safeParse(merged).success).toBe(true);
  });
});
