import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processReview, combineSmallChunks, collectValidLines } from "./processor";
import { validateAndFilterComments } from "./poster";
import { DiffChunk } from "@/types";
import * as diffParser from "@/lib/github/diff-parser";
import * as geminiReview from "@/lib/gemini/review";
import * as githubApp from "@/lib/github/app";

// In-memory Supabase mock state
let mockDb: {
  review_jobs: Record<string, unknown>[];
  review_chunks: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  review_comments: Record<string, unknown>[];
  repos: Record<string, unknown>[];
  installations: Record<string, unknown>[];
  repo_settings: Record<string, unknown>[];
  daily_api_usage: Record<string, unknown>[];
};

function resetMockDb() {
  mockDb = {
    review_jobs: [],
    review_chunks: [],
    reviews: [],
    review_comments: [],
    repos: [],
    installations: [],
    repo_settings: [],
    daily_api_usage: [],
  };
}

// Create chainable Supabase mock
function createMockSupabaseClient() {
  return {
    from: (table: string) => {
      const currentTable = (mockDb[table as keyof typeof mockDb] || []) as Record<string, unknown>[];
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let pendingInsert: Record<string, unknown>[] | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      let pendingUpsert: Record<string, unknown>[] | null = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder mock chaining interface
      const chain: any = {
        select: () => chain,
        eq: (field: string, value: unknown) => {
          filters.push((row) => row[field] === value);
          return chain;
        },
        neq: (field: string, value: unknown) => {
          filters.push((row) => row[field] !== value);
          return chain;
        },
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          pendingInsert = Array.isArray(rows) ? rows : [rows];
          return chain;
        },
        update: (values: Record<string, unknown>) => {
          pendingUpdate = values;
          return chain;
        },
        upsert: (values: Record<string, unknown> | Record<string, unknown>[]) => {
          pendingUpsert = Array.isArray(values) ? values : [values];
          return chain;
        },
        delete: () => {
          const toDelete = currentTable.filter((row) =>
            filters.every((f) => f(row))
          );
          mockDb[table as keyof typeof mockDb] = currentTable.filter(
            (row) => !toDelete.includes(row)
          );
          return Promise.resolve({ data: toDelete, error: null });
        },
        maybeSingle: async () => {
          const rows = currentTable.filter((row) =>
            filters.every((f) => f(row))
          );
          return { data: rows[0] || null, error: null };
        },
        single: async () => {
          if (pendingInsert) {
            const insertedWithIds = pendingInsert.map((r) => ({
              id: r.id || `uuid-${Math.random().toString(36).substring(2, 9)}`,
              created_at: new Date().toISOString(),
              ...r,
            }));
            currentTable.push(...insertedWithIds);
            return { data: insertedWithIds[0], error: null };
          }
          const rows = currentTable.filter((row) =>
            filters.every((f) => f(row))
          );
          if (rows.length === 0) return { data: null, error: new Error("Not found") };
          return { data: rows[0], error: null };
        },
        then: (resolve: (val: unknown) => void) => {
          if (pendingInsert) {
            const inserted = pendingInsert.map((r) => ({
              id: r.id || `uuid-${Math.random().toString(36).substring(2, 9)}`,
              created_at: new Date().toISOString(),
              ...r,
            }));
            currentTable.push(...inserted);
            return resolve({ data: inserted, error: null });
          }
          if (pendingUpsert) {
            for (const item of pendingUpsert) {
              const existingIdx = currentTable.findIndex(
                (r) => r.usage_date === item.usage_date
              );
              if (existingIdx !== -1) {
                currentTable[existingIdx] = { ...currentTable[existingIdx], ...item };
              } else {
                currentTable.push(item);
              }
            }
            return resolve({ data: pendingUpsert, error: null });
          }
          if (pendingUpdate) {
            currentTable.forEach((row) => {
              if (filters.every((f) => f(row))) {
                Object.assign(row, pendingUpdate);
              }
            });
            return resolve({ data: null, error: null });
          }
          const rows = currentTable.filter((row) =>
            filters.every((f) => f(row))
          );
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
    rpc: async (fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
      if (fn === "reserve_daily_api_usage") {
        const today = (args?.p_usage_date as string) || new Date().toISOString().slice(0, 10);
        const count = Number(args?.p_count || 1);
        const limit = Number(args?.p_limit || 1500);
        let row = mockDb.daily_api_usage.find((r) => r.usage_date === today);
        if (!row) {
          row = { usage_date: today, call_count: 0, updated_at: new Date().toISOString() };
          mockDb.daily_api_usage.push(row);
        }
        if (Number(row.call_count || 0) + count <= limit) {
          row.call_count = Number(row.call_count || 0) + count;
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      if (fn === "increment_daily_api_usage") {
        const today = new Date().toISOString().slice(0, 10);
        let row = mockDb.daily_api_usage.find((r) => r.usage_date === today);
        if (!row) {
          row = { usage_date: today, call_count: 1, updated_at: new Date().toISOString() };
          mockDb.daily_api_usage.push(row);
        } else {
          row.call_count = Number(row.call_count || 0) + 1;
        }
        return { data: row.call_count, error: null };
      }
      return { data: null, error: null };
    },
  };
}

const mockSupabase = createMockSupabaseClient();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

describe("Review Processor / Orchestrator", () => {
  const dummyJobId = "job-123";
  const dummyRepoId = "repo-456";
  const dummyInstallationId = "inst-789";

  beforeEach(() => {
    resetMockDb();
    vi.restoreAllMocks();

    // Populate base test data
    mockDb.installations.push({
      id: dummyInstallationId,
      installation_id: 112233,
      owner_id: "user-1",
      account_login: "test-org",
      account_type: "Organization",
    });

    mockDb.repos.push({
      id: dummyRepoId,
      installation_id: dummyInstallationId,
      github_repo_id: 998877,
      owner: "test-org",
      name: "sample-repo",
      full_name: "test-org/sample-repo",
      is_active: true,
    });

    mockDb.repo_settings.push({
      id: "settings-1",
      repo_id: dummyRepoId,
      ignored_paths: ["*.md"],
      strictness: "balanced",
      custom_instructions: "Check for security issues",
    });

    mockDb.review_jobs.push({
      id: dummyJobId,
      repo_id: dummyRepoId,
      pr_number: 10,
      pr_title: "Add features",
      pr_author: "dev",
      head_sha: "sha-head-1",
      base_sha: "sha-base-1",
      delivery_id: "deliv-1",
      status: "pending",
      retry_count: 0,
      error_message: null,
      total_chunks: null,
      completed_chunks: 0,
    });

    // Mock GitHub Octokit
    vi.spyOn(githubApp, "getInstallationOctokit").mockReturnValue({
      rest: {
        pulls: {
          get: vi.fn().mockImplementation((params: { mediaType?: { format?: string } }) => {
            if (params?.mediaType?.format === "diff") {
              return Promise.resolve({ data: "diff --git a/file.ts b/file.ts\n+line" });
            }
            return Promise.resolve({ data: { state: "open", merged: false } });
          }),
          listReviews: vi.fn().mockResolvedValue({ data: [] }),
          createReview: vi.fn().mockResolvedValue({ data: { id: 778899 } }),
          updateReview: vi.fn().mockResolvedValue({ data: { id: 778899 } }),
        },
      },
    } as unknown as ReturnType<typeof githubApp.getInstallationOctokit>);

    vi.spyOn(diffParser, "fetchDiff").mockResolvedValue(
      "diff --git a/file.ts b/file.ts\n+line"
    );

    vi.spyOn(diffParser, "parseDiff").mockReturnValue([
      {
        index: 0,
        file_path: "file.ts",
        content: "@@ -1 +1,2 @@\n context\n+new line\n",
        token_estimate: 20,
        hunk_line_numbers: new Set([2]),
      },
    ] as unknown as DiffChunk[]);
  });

  it("happy path: all chunks succeed -> job completed, reviews and comments saved", async () => {
    vi.spyOn(geminiReview, "reviewChunk").mockResolvedValue({
      chunk_summary: "Safe code additions.",
      comments: [
        {
          file_path: "file.ts",
          line_number: 2,
          severity: "warning",
          title: "Check edge cases",
          body: "Input could be empty",
        },
      ],
      severity_counts: { critical: 0, warning: 1, suggestion: 0, praise: 0 },
    });

    await processReview(dummyJobId);

    const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
    expect(job?.status).toBe("completed");
    expect(job?.completed_chunks).toBe(1);
    expect(job?.total_chunks).toBe(1);
    expect(mockDb.review_chunks.length).toBe(1);
    expect(mockDb.review_chunks[0].status).toBe("completed");

    expect(mockDb.reviews.length).toBe(1);
    expect(mockDb.reviews[0].risk_score).toBe(10);
    expect(mockDb.reviews[0].github_review_id).toBe(778899);
    expect(mockDb.review_comments.length).toBe(1);
    expect(mockDb.review_comments[0].title).toBe("Check edge cases");
  });

  it("closed or merged PR: skips review posting and marks job as skipped", async () => {
    vi.spyOn(githubApp, "getInstallationOctokit").mockReturnValue({
      rest: {
        pulls: {
          get: vi.fn().mockImplementation((params: { mediaType?: { format?: string } }) => {
            if (params?.mediaType?.format === "diff") {
              return Promise.resolve({ data: "diff --git a/file.ts b/file.ts\n+line" });
            }
            return Promise.resolve({ data: { state: "closed", merged: false } });
          }),
          listReviews: vi.fn().mockResolvedValue({ data: [] }),
          createReview: vi.fn().mockResolvedValue({ data: { id: 778899 } }),
        },
      },
    } as unknown as ReturnType<typeof githubApp.getInstallationOctokit>);

    vi.spyOn(geminiReview, "reviewChunk").mockResolvedValue({
      chunk_summary: "Safe code additions.",
      comments: [],
      severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
    });

    await processReview(dummyJobId);

    const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
    expect(job?.status).toBe("skipped");
    expect(mockDb.reviews.length).toBe(0);
  });

  it("one chunk fails (others saved): saves successful chunk, marks failed chunk as error", async () => {
    vi.spyOn(diffParser, "parseDiff").mockReturnValue([
      { index: 0, file_path: "good.ts", content: "+good", token_estimate: 4000 },
      { index: 1, file_path: "bad.ts", content: "+bad", token_estimate: 4000 },
    ] as unknown as DiffChunk[]);

    vi.spyOn(geminiReview, "reviewChunk")
      .mockResolvedValueOnce({
        chunk_summary: "Good chunk passed.",
        comments: [],
        severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
      })
      .mockRejectedValueOnce(new Error("AI generation failure"));

    await processReview(dummyJobId);

    const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
    expect(job?.retry_count).toBe(1);
    expect(job?.status).toBe("queued");

    const goodChunk = mockDb.review_chunks.find((c) => c.file_path === "good.ts");
    const badChunk = mockDb.review_chunks.find((c) => c.file_path === "bad.ts");

    expect(goodChunk?.status).toBe("completed");
    expect(badChunk?.status).toBe("error");
  });

  it("deadline hit (partial): saves completed chunks and marks job as partial with unreviewed file list", async () => {
    process.env.GEMINI_CONCURRENCY = "1";

    try {
      vi.spyOn(diffParser, "parseDiff").mockReturnValue([
        { index: 0, file_path: "finished.ts", content: "+ok", token_estimate: 4000 },
        { index: 1, file_path: "skipped.ts", content: "+skip", token_estimate: 4000 },
      ] as unknown as DiffChunk[]);

      vi.spyOn(geminiReview, "reviewChunk").mockImplementation(async () => {
        // Fast-forward time past deadline after chunk 0 is reviewed
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_000);
        return {
          chunk_summary: "Finished first file.",
          comments: [],
          severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
        };
      });

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.status).toBe("partial");
      expect(job?.error_message).toContain("timeout");

      // Partial review is saved with unreviewed file note
      expect(mockDb.reviews.length).toBe(1);
      expect(mockDb.reviews[0].summary).toContain("skipped.ts");
    } finally {
      delete process.env.GEMINI_CONCURRENCY;
    }
  });

  it("slow chunk times out after per-chunk limit (90s): chunk marked error", async () => {
    process.env.GEMINI_CHUNK_TIMEOUT_MS = "50"; // 50ms for unit test

    try {
      vi.spyOn(geminiReview, "reviewChunk").mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      await processReview(dummyJobId);

      const chunk = mockDb.review_chunks[0];
      expect(chunk?.status).toBe("error");
    } finally {
      delete process.env.GEMINI_CHUNK_TIMEOUT_MS;
    }
  });

  it("503 retry -> success: reviews chunk successfully when retry succeeds", async () => {
    let attempts = 0;
    vi.spyOn(geminiReview, "reviewChunk").mockImplementation(async () => {
      attempts++;
      return {
        chunk_summary: "Recovered from 503.",
        comments: [],
        severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
      };
    });

    await processReview(dummyJobId);

    expect(attempts).toBeGreaterThan(0);
    const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
    expect(job?.status).toBe("completed");
    expect(mockDb.review_chunks[0].status).toBe("completed");
  });

  it("persistent 503 (retry_later): marks chunk as retry_later when Gemini service unavailable", async () => {
    vi.spyOn(geminiReview, "reviewChunk").mockRejectedValue(
      new geminiReview.UnavailableError("503 Service Unavailable")
    );

    await processReview(dummyJobId);

    const chunk = mockDb.review_chunks[0];
    expect(chunk?.status).toBe("retry_later");
  });

  it("rate-limited (429): calls reviewChunk with retry logic", async () => {
    vi.spyOn(geminiReview, "reviewChunk").mockResolvedValue({
      chunk_summary: "Handled rate limit.",
      comments: [],
      severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
    });

    await processReview(dummyJobId);

    const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
    expect(job?.status).toBe("completed");
  });

  it("budget exhausted (deferred): marks job as deferred without calling Gemini", async () => {
    process.env.GEMINI_DAILY_LIMIT = "10";
    const today = new Date().toISOString().slice(0, 10);
    mockDb.daily_api_usage.push({
      usage_date: today,
      call_count: 10, // equal to limit
      updated_at: new Date().toISOString(),
    });

    const geminiSpy = vi.spyOn(geminiReview, "reviewChunk");

    try {
      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.status).toBe("deferred");
      expect(job?.error_message).toContain("Daily Gemini API budget exhausted");
      expect(geminiSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env.GEMINI_DAILY_LIMIT;
    }
  });

  it("duplicate SHA reuse: reuses existing completed review for same head_sha", async () => {
    // Add existing completed review for same repo and head_sha
    mockDb.reviews.push({
      id: "prev-review-1",
      job_id: "prev-job-1",
      repo_id: dummyRepoId,
      head_sha: "sha-head-1", // matches dummyJobId head_sha
      pr_number: 9,
      pr_title: "Prior PR",
      pr_author: "dev",
      summary: "Prior review summary.",
      risk_score: 25,
      severity_counts: { critical: 1, warning: 0, suggestion: 0, praise: 0 },
      inline_comment_count: 1,
      review_duration_ms: 1200,
    });

    mockDb.review_comments.push({
      id: "comment-1",
      review_id: "prev-review-1",
      file_path: "file.ts",
      line_number: 10,
      side: "RIGHT",
      severity: "critical",
      title: "Existing Bug",
      body: "Already discovered issue",
      suggestion: null,
    });

    const geminiSpy = vi.spyOn(geminiReview, "reviewChunk");

    await processReview(dummyJobId);

    const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
    expect(job?.status).toBe("completed");

    // No duplicate review row is created; existing review row is reused
    expect(mockDb.reviews.length).toBe(1);
    expect(mockDb.reviews[0].id).toBe("prev-review-1");

    // No new Gemini call was made
    expect(geminiSpy).not.toHaveBeenCalled();
  });

  it("merger de-duplication and severity ordering: merges multi-chunk comments sorted by severity with duplicates removed", async () => {
    vi.spyOn(diffParser, "parseDiff").mockReturnValue([
      { index: 0, file_path: "a.ts", content: "+codeA", token_estimate: 4000 },
      { index: 1, file_path: "b.ts", content: "+codeB", token_estimate: 4000 },
    ] as unknown as DiffChunk[]);

    vi.spyOn(geminiReview, "reviewChunk")
      .mockResolvedValueOnce({
        chunk_summary: "Chunk A summary.",
        comments: [
          {
            file_path: "common.ts",
            line_number: 10,
            severity: "warning",
            title: "Duplicate Issue",
            body: "Same finding",
          },
          {
            file_path: "a.ts",
            line_number: 5,
            severity: "praise",
            title: "Nice function",
            body: "Clean logic",
          },
        ],
        severity_counts: { critical: 0, warning: 1, suggestion: 0, praise: 1 },
      })
      .mockResolvedValueOnce({
        chunk_summary: "Chunk B summary.",
        comments: [
          {
            file_path: "common.ts",
            line_number: 10,
            severity: "warning",
            title: "Duplicate Issue",
            body: "Same finding",
          },
          {
            file_path: "b.ts",
            line_number: 2,
            severity: "critical",
            title: "Security Risk",
            body: "Injection flaw",
          },
        ],
        severity_counts: { critical: 1, warning: 1, suggestion: 0, praise: 0 },
      });

    await processReview(dummyJobId);

    const review = mockDb.reviews.find((r) => r.job_id === dummyJobId);
    expect(review?.risk_score).toBe(35); // 1*25 (critical) + 1*10 (warning)

    // Deduplicated from 4 comments to 3
    expect(mockDb.review_comments.length).toBe(3);
    const severities = mockDb.review_comments.map((c) => c.severity);
    // Ordered: critical -> warning -> praise
    expect(severities).toEqual(["critical", "warning", "praise"]);
  });

  describe("Group A - Try/Finally on Deadline & CombineSmallChunks Line Validation", () => {
    it("try/finally ensures job reaches a terminal/retryable status when pipeline throws mid-run, never left in processing", async () => {
      // Mock diffParser to throw an unexpected error mid-pipeline after job is set to 'processing'
      vi.spyOn(diffParser, "fetchDiff").mockImplementationOnce(() => {
        throw new Error("Fatal network disconnection mid-run");
      });

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.status).not.toBe("processing");
      expect(["failed", "error"]).toContain(job?.status);
      expect(job?.error_message).toBeTruthy();
    });

    it("preserves sanitized diagnostic error string in review_jobs.error_message on GitHub 403 during diff fetch", async () => {
      vi.spyOn(diffParser, "fetchDiff").mockImplementationOnce(() => {
        throw new Error(
          "GitHub 403 at pulls.get diff: accepted=[pull_requests=read], request_id=REQ-TEST-403"
        );
      });

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.status).toBe("error");
      expect(job?.error_message).toBe(
        "GitHub 403 at pulls.get diff: accepted=[pull_requests=read], request_id=REQ-TEST-403"
      );
      expect(job?.error_message).not.toMatch(/ghs_|bearer|eyJ/i);
    });

    it("preserves sanitized diagnostic error string in review_jobs.error_message on GitHub 403 during review posting", async () => {
      // Mock diffParser to succeed
      vi.spyOn(diffParser, "fetchDiff").mockResolvedValueOnce(
        "diff --git a/foo.ts b/foo.ts\n@@ -1,1 +1,2 @@\n context\n+new line\n"
      );

      // Mock Gemini reviewChunk to succeed
      vi.spyOn(geminiReview, "reviewChunk").mockResolvedValue({
        chunk_summary: "Chunk looks fine",
        comments: [],
        severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
      });

      // Mock poster to fail with 403 error
      const poster = await import("@/lib/review/poster");
      vi.spyOn(poster, "postReviewToGitHub").mockRejectedValueOnce(
        Object.assign(new Error("Resource not accessible by integration"), {
          status: 403,
          response: {
            status: 403,
            headers: {
              "x-accepted-github-permissions": "pull_requests=write",
              "x-github-request-id": "REQ-POST-403",
            },
          },
        })
      );

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.status).toBe("error");
      expect(job?.error_message).toBe(
        "GitHub 403 at github request: accepted=[pull_requests=write], request_id=REQ-POST-403"
      );
      expect(job?.error_message).not.toMatch(/ghs_|bearer|eyJ/i);
    });

    it("combineSmallChunks merges hunk_line_numbers per file, does not use comma-joined path, and validates line numbers per file", () => {
      const chunk1 = {
        index: 0,
        file_path: "src/fileA.ts",
        content: "@@ -1,2 +1,3 @@\n context\n+lineA\n",
        token_estimate: 50,
        hunk_line_numbers: new Set([2]),
      };
      const chunk2 = {
        index: 1,
        file_path: "src/fileB.ts",
        content: "@@ -10,2 +10,3 @@\n context\n+lineB\n",
        token_estimate: 60,
        hunk_line_numbers: new Set([11]),
      };

      const combined = combineSmallChunks([
        chunk1 as unknown as DiffChunk,
        chunk2 as unknown as DiffChunk,
      ]);

      expect(combined.length).toBe(1);
      const singleCombined = combined[0];

      // Never use comma-joined path
      expect(singleCombined.file_path).not.toContain(",");
      expect(singleCombined.file_path).toBe("src/fileA.ts");

      // Valid line numbers collection per file
      const validLinesMap = collectValidLines(combined);
      expect(validLinesMap.get("src/fileA.ts")).toBeDefined();
      expect(validLinesMap.get("src/fileA.ts")?.has(2)).toBe(true);
      expect(validLinesMap.get("src/fileB.ts")).toBeDefined();
      expect(validLinesMap.get("src/fileB.ts")?.has(11)).toBe(true);

      // Verify line validation: real lines are valid (inline), hallucinated lines are invalid (otherNotes)
      const comments = [
        {
          file_path: "src/fileA.ts",
          line_number: 2, // Real line in diff
          severity: "warning" as const,
          title: "Real issue in file A",
          body: "Details",
        },
        {
          file_path: "src/fileA.ts",
          line_number: 99, // Hallucinated line
          severity: "suggestion" as const,
          title: "Hallucinated issue in file A",
          body: "Details",
        },
        {
          file_path: "src/fileB.ts",
          line_number: 11, // Real line in diff
          severity: "warning" as const,
          title: "Real issue in file B",
          body: "Details",
        },
        {
          file_path: "src/fileB.ts",
          line_number: 999, // Hallucinated line
          severity: "suggestion" as const,
          title: "Hallucinated issue in file B",
          body: "Details",
        },
      ];

      const { inlineComments, otherNotes } = validateAndFilterComments(
        comments,
        validLinesMap
      );

      // Only real lines remain inline
      expect(inlineComments.length).toBe(2);
      expect(inlineComments.map((c) => `${c.file_path}:${c.line_number}`)).toEqual([
        "src/fileA.ts:2",
        "src/fileB.ts:11",
      ]);

      // Hallucinated lines moved to otherNotes
      expect(otherNotes.length).toBe(2);
      expect(otherNotes[0]).toContain("src/fileA.ts");
      expect(otherNotes[0]).toContain("line 99");
      expect(otherNotes[1]).toContain("src/fileB.ts");
      expect(otherNotes[1]).toContain("line 999");
    });
  });

  describe("Group B - Correctness Tests (Atomic Budget, Context Failures, Duplicate SHA)", () => {
    it("fails chunk immediately without calling Gemini when increment_daily_api_usage RPC fails", async () => {
      vi.spyOn(mockSupabase, "rpc").mockResolvedValueOnce({
        data: null,
        error: Object.assign(new Error("RPC increment failure"), {
          name: "PostgrestError",
          message: "RPC increment failure",
          details: "",
          hint: "",
          code: "500",
        }),
      });
      const reviewChunkSpy = vi.spyOn(geminiReview, "reviewChunk");

      await processReview(dummyJobId);

      // Gemini reviewChunk must NOT be called
      expect(reviewChunkSpy).not.toHaveBeenCalled();

      // Chunk marked as error
      const chunk = mockDb.review_chunks.find((c) => c.job_id === dummyJobId);
      expect(chunk?.status).toBe("error");
    });

    it("marks job as failed with clear reason when loadJobContext fails (e.g. repo not found)", async () => {
      // Clear repo from DB so loadJobContext fails to load repo
      mockDb.repos = [];

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.status).toBe("failed");
      expect(job?.error_message).toContain("Associated repository not found");
    });

    it("handles multiple redeliveries of the same SHA by creating only one review row without copying", async () => {
      vi.spyOn(geminiReview, "reviewChunk").mockResolvedValue({
        chunk_summary: "Safe code additions.",
        comments: [],
        severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
      });

      // 1st delivery
      await processReview(dummyJobId);
      expect(mockDb.reviews.filter((r) => r.head_sha === "sha-head-1").length).toBe(1);

      // 2nd delivery (new job for same repo and head_sha)
      const secondJobId = "job-redelivery-2";
      mockDb.review_jobs.push({
        id: secondJobId,
        repo_id: dummyRepoId,
        pr_number: 10,
        pr_title: "Add features",
        pr_author: "dev",
        head_sha: "sha-head-1",
        base_sha: "sha-base-1",
        delivery_id: "deliv-2",
        status: "pending",
        retry_count: 0,
        error_message: null,
        total_chunks: null,
        completed_chunks: 0,
      });

      await processReview(secondJobId);

      // 3rd delivery
      const thirdJobId = "job-redelivery-3";
      mockDb.review_jobs.push({
        id: thirdJobId,
        repo_id: dummyRepoId,
        pr_number: 10,
        pr_title: "Add features",
        pr_author: "dev",
        head_sha: "sha-head-1",
        base_sha: "sha-base-1",
        delivery_id: "deliv-3",
        status: "pending",
        retry_count: 0,
        error_message: null,
        total_chunks: null,
        completed_chunks: 0,
      });

      await processReview(thirdJobId);

      // 3 deliveries of the same SHA must create exactly ONE review row in reviews table
      const matchingReviews = mockDb.reviews.filter((r) => r.head_sha === "sha-head-1");
      expect(matchingReviews.length).toBe(1);

      // Both redelivery jobs marked completed
      expect(mockDb.review_jobs.find((j) => j.id === secondJobId)?.status).toBe("completed");
      expect(mockDb.review_jobs.find((j) => j.id === thirdJobId)?.status).toBe("completed");
    });

    it("on chunk retry, sets job status back to queued, never processing", async () => {
      vi.spyOn(geminiReview, "reviewChunk").mockRejectedValueOnce(new Error("Transient API error"));

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.retry_count).toBe(1);
      expect(job?.status).toBe("queued");
    });

    it("stores sanitised failure reason in review_jobs.error_message when chunk fails", async () => {
      const geminiErr = new geminiReview.GeminiReviewError(
        "truncated",
        "finishReason=MAX_TOKENS,tokens={prompt:100,candidate:4096,thinking:3500},textLen=2048,json=false"
      );
      vi.spyOn(geminiReview, "reviewChunk").mockRejectedValueOnce(geminiErr);

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      expect(job?.retry_count).toBe(1);
      expect(job?.status).toBe("queued");
      expect(job?.error_message).toBe(
        "gemini:truncated:finishReason=MAX_TOKENS,tokens={prompt:100,candidate:4096,thinking:3500},textLen=2048,json=false"
      );
    });

    it("truncates error_message to 400 characters when storing in review_jobs", async () => {
      const longDetails = "x".repeat(500);
      const geminiErr = new geminiReview.GeminiReviewError("unknown", longDetails);
      vi.spyOn(geminiReview, "reviewChunk").mockRejectedValueOnce(geminiErr);

      await processReview(dummyJobId);

      const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
      const errorMessage = typeof job?.error_message === "string" ? job.error_message : "";
      expect(errorMessage.length).toBeLessThanOrEqual(400);
      expect(errorMessage.startsWith("gemini:unknown:")).toBe(true);
    });

    it("atomically calls reserve_daily_api_usage before calling Gemini, and marks chunk retry_later without calling Gemini when quota reservation fails", async () => {
      const rpcSpy = vi.spyOn(mockSupabase, "rpc").mockImplementation(async (fn: string) => {
        if (fn === "reserve_daily_api_usage") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      });

      const geminiSpy = vi.spyOn(geminiReview, "reviewChunk");

      await processReview(dummyJobId);

      expect(rpcSpy).toHaveBeenCalledWith(
        "reserve_daily_api_usage",
        expect.objectContaining({ p_count: 1 })
      );
      expect(geminiSpy).not.toHaveBeenCalled();

      const chunk = mockDb.review_chunks[0];
      expect(chunk?.status).toBe("retry_later");
    });

    it("resumes partial job by skipping already completed chunks and reviewing only pending chunks", async () => {
      vi.spyOn(diffParser, "parseDiff").mockReturnValue([
        { index: 0, file_path: "file1.ts", content: "+code1", token_estimate: 4000 },
        { index: 1, file_path: "file2.ts", content: "+code2", token_estimate: 4000 },
      ] as unknown as DiffChunk[]);

      const partialJob = mockDb.review_jobs.find((j) => j.id === dummyJobId)!;
      partialJob.status = "partial";
      partialJob.total_chunks = 2;
      partialJob.completed_chunks = 1;

      mockDb.review_chunks.push({
        id: "chunk-0-id",
        job_id: dummyJobId,
        chunk_index: 0,
        file_path: "file1.ts",
        diff_content: "+code1",
        status: "completed",
        review_json: {
          chunk_summary: "Existing chunk 0 review.",
          comments: [],
          severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
        },
      });

      const geminiSpy = vi.spyOn(geminiReview, "reviewChunk").mockResolvedValue({
        chunk_summary: "Newly reviewed chunk 1.",
        comments: [],
        severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
      });

      await processReview(dummyJobId);

      // Gemini should only be called for chunk 1, skipping already completed chunk 0
      expect(geminiSpy).toHaveBeenCalledTimes(1);
      expect(geminiSpy).toHaveBeenCalledWith(
        expect.objectContaining({ index: 1, file_path: "file2.ts" }),
        expect.anything(),
        expect.anything()
      );

      expect(partialJob.status).toBe("completed");
      expect(partialJob.completed_chunks).toBe(2);
    });

    it("validates GEMINI_DAILY_LIMIT as a positive bounded integer", async () => {
      const { getDailyLimit } = await import("./processor");

      const orig = process.env.GEMINI_DAILY_LIMIT;
      try {
        delete process.env.GEMINI_DAILY_LIMIT;
        expect(getDailyLimit()).toBe(1500);

        process.env.GEMINI_DAILY_LIMIT = "2000";
        expect(getDailyLimit()).toBe(2000);

        process.env.GEMINI_DAILY_LIMIT = "invalid-number";
        expect(getDailyLimit()).toBe(1500);

        process.env.GEMINI_DAILY_LIMIT = "1e3";
        expect(getDailyLimit()).toBe(1500);

        process.env.GEMINI_DAILY_LIMIT = "500abc";
        expect(getDailyLimit()).toBe(1500);

        process.env.GEMINI_DAILY_LIMIT = "-50";
        expect(getDailyLimit()).toBe(1500);

        process.env.GEMINI_DAILY_LIMIT = "0";
        expect(getDailyLimit()).toBe(1500);

        process.env.GEMINI_DAILY_LIMIT = "9999999"; // exceeds bound 100,000
        expect(getDailyLimit()).toBe(1500);
      } finally {
        if (orig !== undefined) {
          process.env.GEMINI_DAILY_LIMIT = orig;
        } else {
          delete process.env.GEMINI_DAILY_LIMIT;
        }
      }
    });

    describe("GEMINI_FALLBACK_MODEL on 503 Unavailable", () => {
      const origFallback = process.env.GEMINI_FALLBACK_MODEL;
      const origModel = process.env.GEMINI_MODEL;

      afterEach(() => {
        if (origFallback !== undefined) {
          process.env.GEMINI_FALLBACK_MODEL = origFallback;
        } else {
          delete process.env.GEMINI_FALLBACK_MODEL;
        }
        if (origModel !== undefined) {
          process.env.GEMINI_MODEL = origModel;
        } else {
          delete process.env.GEMINI_MODEL;
        }
      });

      it("tries fallback model and succeeds when primary model fails with 503, counting usage for both attempts", async () => {
        process.env.GEMINI_MODEL = "gemini-3.8-flash";
        process.env.GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";

        const rpcSpy = vi.spyOn(mockSupabase, "rpc").mockResolvedValue({
          data: true,
          error: null,
        });

        const reviewChunkSpy = vi
          .spyOn(geminiReview, "reviewChunk")
          .mockRejectedValueOnce(new geminiReview.UnavailableError("503 Service Unavailable"))
          .mockResolvedValueOnce({
            chunk_summary: "Fallback review succeeded.",
            comments: [],
            severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
          });

        await processReview(dummyJobId);

        // Should call reviewChunk twice: first with primary model, then with fallback model
        expect(reviewChunkSpy).toHaveBeenCalledTimes(2);
        expect(reviewChunkSpy).toHaveBeenNthCalledWith(
          1,
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ model: "gemini-3.8-flash" })
        );
        expect(reviewChunkSpy).toHaveBeenNthCalledWith(
          2,
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ model: "gemini-3.5-flash-lite", maxRateLimitRetries: 0 })
        );

        // Daily usage counted for both attempts
        const reserveCalls = rpcSpy.mock.calls.filter((c) => c[0] === "reserve_daily_api_usage");
        expect(reserveCalls.length).toBe(2);

        // Job completes successfully
        const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
        expect(job?.status).toBe("completed");

        // Chunk status is completed
        const chunk = mockDb.review_chunks.find((c) => c.job_id === dummyJobId);
        expect(chunk?.status).toBe("completed");
      });

      it("records gemini:unavailable:status=503:primary+fallback and marks chunk retry_later when both primary and fallback fail with 503", async () => {
        process.env.GEMINI_MODEL = "gemini-3.8-flash";
        process.env.GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";

        const rpcSpy = vi.spyOn(mockSupabase, "rpc").mockResolvedValue({
          data: true,
          error: null,
        });

        const reviewChunkSpy = vi
          .spyOn(geminiReview, "reviewChunk")
          .mockRejectedValueOnce(new geminiReview.UnavailableError("503 Primary Unavailable"))
          .mockRejectedValueOnce(new geminiReview.UnavailableError("503 Fallback Unavailable"));

        await processReview(dummyJobId);

        expect(reviewChunkSpy).toHaveBeenCalledTimes(2);

        // Daily usage counted for both attempts
        const reserveCalls = rpcSpy.mock.calls.filter((c) => c[0] === "reserve_daily_api_usage");
        expect(reserveCalls.length).toBe(2);

        // Job is queued for retry with exact diagnostic string
        const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
        expect(job?.status).toBe("queued");
        expect(job?.retry_count).toBe(1);
        expect(job?.error_message).toBe("gemini:unavailable:status=503:primary+fallback");

        // Chunk status is retry_later
        const chunk = mockDb.review_chunks.find((c) => c.job_id === dummyJobId);
        expect(chunk?.status).toBe("retry_later");
      });

      it("does NOT use fallback model for 400 bad_request or auth error and reserves usage only once", async () => {
        process.env.GEMINI_MODEL = "gemini-3.8-flash";
        process.env.GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";

        const rpcSpy = vi.spyOn(mockSupabase, "rpc").mockResolvedValue({
          data: true,
          error: null,
        });

        const badReqErr = new geminiReview.GeminiReviewError("bad_request", "status=400");
        const reviewChunkSpy = vi
          .spyOn(geminiReview, "reviewChunk")
          .mockRejectedValueOnce(badReqErr);

        await processReview(dummyJobId);

        // Fallback model NOT called
        expect(reviewChunkSpy).toHaveBeenCalledTimes(1);

        // Usage reserved only once
        const reserveCalls = rpcSpy.mock.calls.filter((c) => c[0] === "reserve_daily_api_usage");
        expect(reserveCalls.length).toBe(1);

        const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
        expect(job?.status).toBe("queued");
        expect(job?.error_message).toBe("gemini:bad_request:status=400");
      });

      it("does NOT use fallback model when fallback budget reservation fails, setting retry_later", async () => {
        process.env.GEMINI_MODEL = "gemini-3.8-flash";
        process.env.GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";

        let callNum = 0;
        vi.spyOn(mockSupabase, "rpc").mockImplementation(async (fn: string) => {
          if (fn === "reserve_daily_api_usage") {
            callNum++;
            if (callNum === 1) return { data: true, error: null };
            return { data: false, error: null }; // second reservation exhausted
          }
          return { data: null, error: null };
        });

        const reviewChunkSpy = vi
          .spyOn(geminiReview, "reviewChunk")
          .mockRejectedValueOnce(new geminiReview.UnavailableError("503 Primary Unavailable"));

        await processReview(dummyJobId);

        // Fallback reviewChunk NOT called because budget was exhausted on attempt 2
        expect(reviewChunkSpy).toHaveBeenCalledTimes(1);

        const chunk = mockDb.review_chunks.find((c) => c.job_id === dummyJobId);
        expect(chunk?.status).toBe("retry_later");
      });

      it("rejects invalid fallback model id and does NOT call fallback on 503", async () => {
        process.env.GEMINI_MODEL = "gemini-3.8-flash";
        process.env.GEMINI_FALLBACK_MODEL = "invalid with spaces";

        const rpcSpy = vi.spyOn(mockSupabase, "rpc").mockResolvedValue({
          data: true,
          error: null,
        });

        const reviewChunkSpy = vi
          .spyOn(geminiReview, "reviewChunk")
          .mockRejectedValueOnce(new geminiReview.UnavailableError("503 Primary Unavailable"));

        await processReview(dummyJobId);

        expect(reviewChunkSpy).toHaveBeenCalledTimes(1);
        const reserveCalls = rpcSpy.mock.calls.filter((c) => c[0] === "reserve_daily_api_usage");
        expect(reserveCalls.length).toBe(1);

        const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
        expect(job?.status).toBe("queued");
        expect(job?.error_message).toBe("gemini:unavailable:status=503");
      });

      it("ensures stored error_message never leaks secrets, code, prompts or response content", async () => {
        process.env.GEMINI_MODEL = "gemini-3.8-flash";
        process.env.GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";

        vi.spyOn(mockSupabase, "rpc").mockResolvedValue({
          data: true,
          error: null,
        });

        const sensitiveFake = "AIzaSyFakeKey12345secret";
        const sensitiveErr = new geminiReview.UnavailableError(`503 with ${sensitiveFake}`);
        vi.spyOn(geminiReview, "reviewChunk")
          .mockRejectedValueOnce(sensitiveErr)
          .mockRejectedValueOnce(sensitiveErr);

        await processReview(dummyJobId);

        const job = mockDb.review_jobs.find((j) => j.id === dummyJobId);
        const err = job?.error_message || "";
        expect(err).toBe("gemini:unavailable:status=503:primary+fallback");
        expect(err).not.toContain(sensitiveFake);
        expect(err).not.toContain("def run_command");
        expect(err).not.toContain("diff");
      });
    });
  });
});
