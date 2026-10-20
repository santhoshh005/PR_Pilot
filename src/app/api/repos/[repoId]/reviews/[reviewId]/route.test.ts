import { describe, it, expect, vi, beforeEach } from "vitest";

let currentUser: { id: string } | null = null;
let mockRepos: Record<string, unknown>[] = [];
let mockReviews: Record<string, unknown>[] = [];
let mockComments: Record<string, unknown>[] = [];

const mockUserClient = {
  auth: {
    getUser: vi.fn(async () => {
      if (!currentUser) {
        return { data: { user: null }, error: new Error("Not authenticated") };
      }
      return { data: { user: currentUser }, error: null };
    }),
  },
  from: (table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder mock chaining interface
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val);
        return chain;
      },
      order: () => chain,
      maybeSingle: async () => {
        const source =
          table === "repos"
            ? mockRepos
            : table === "reviews"
            ? mockReviews
            : mockComments;
        const rows = source.filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] || null, error: null };
      },
      then: (resolve: (val: unknown) => void) => {
        const source =
          table === "repos"
            ? mockRepos
            : table === "reviews"
            ? mockReviews
            : mockComments;
        const rows = source.filter((r) => filters.every((f) => f(r)));
        return resolve({ data: rows, error: null });
      },
    };
    return chain;
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => mockUserClient),
}));

describe("GET /api/repos/[repoId]/reviews/[reviewId]", () => {
  const validRepoId = "11111111-1111-4111-a111-111111111111";
  const validReviewId = "22222222-2222-4222-a222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "user-uuid-1" };
    mockRepos = [{ id: validRepoId }];
    mockReviews = [
      {
        id: validReviewId,
        repo_id: validRepoId,
        pr_number: 10,
        pr_title: "Title",
        pr_author: "author",
        head_sha: "sha",
        summary: "LGTM",
        risk_score: 25,
        severity_counts: { critical: 0, warning: 0, suggestion: 1, praise: 0 },
        inline_comment_count: 1,
        review_duration_ms: 800,
        created_at: new Date().toISOString(),
      },
    ];
    mockComments = [
      {
        id: "comm-1",
        review_id: validReviewId,
        file_path: "src/main.ts",
        line_number: 15,
        severity: "suggestion",
        title: "Style note",
        body: "Consider renaming variable",
        suggestion: "const clean = 1;",
        created_at: new Date().toISOString(),
      },
    ];
  });

  it("returns 401 when user is not signed in", async () => {
    currentUser = null;
    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost:3000/api/repos/${validRepoId}/reviews/${validReviewId}`
    );

    const res = await GET(req, {
      params: Promise.resolve({ repoId: validRepoId, reviewId: validReviewId }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when repoId or reviewId is not a valid UUID", async () => {
    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost:3000/api/repos/bad-id/reviews/${validReviewId}`
    );

    const res = await GET(req, {
      params: Promise.resolve({ repoId: "bad-id", reviewId: validReviewId }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_request");
  });

  it("returns 404 when review does not exist or repo belongs to another user (identical response)", async () => {
    mockReviews = []; // review not found
    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost:3000/api/repos/${validRepoId}/reviews/${validReviewId}`
    );

    const res = await GET(req, {
      params: Promise.resolve({ repoId: validRepoId, reviewId: validReviewId }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns single review and its inline comments as plain strings", async () => {
    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost:3000/api/repos/${validRepoId}/reviews/${validReviewId}`
    );

    const res = await GET(req, {
      params: Promise.resolve({ repoId: validRepoId, reviewId: validReviewId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.review).toBeDefined();
    expect(body.review.id).toBe(validReviewId);
    expect(body.review.summary).toBe("LGTM");
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].body).toBe("Consider renaming variable");
  });
});
