import { describe, it, expect, vi, beforeEach } from "vitest";

let currentUser: { id: string } | null = null;
let mockRepos: Record<string, unknown>[] = [];
let mockReviews: Record<string, unknown>[] = [];

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
    let rangeFrom = 0;
    let rangeTo = Infinity;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder mock chaining interface
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val);
        return chain;
      },
      order: () => chain,
      range: (from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return chain;
      },
      maybeSingle: async () => {
        const rows = (table === "repos" ? mockRepos : mockReviews).filter((r) =>
          filters.every((f) => f(r))
        );
        return { data: rows[0] || null, error: null };
      },
      then: (resolve: (val: unknown) => void) => {
        if (table === "repos") {
          const rows = mockRepos.filter((r) => filters.every((f) => f(r)));
          return resolve({ data: rows, error: null });
        }
        if (table === "reviews") {
          const matching = mockReviews.filter((r) => filters.every((f) => f(r)));
          const paged = matching.slice(rangeFrom, rangeTo + 1);
          return resolve({ data: paged, count: matching.length, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => mockUserClient),
}));

describe("GET /api/repos/[repoId]/reviews", () => {
  const validRepoId = "11111111-1111-4111-a111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "user-uuid-1" };
    mockRepos = [{ id: validRepoId, full_name: "owner/repo" }];
    mockReviews = [];
  });

  it("returns 401 when user is not signed in", async () => {
    currentUser = null;
    const { GET } = await import("./route");
    const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/reviews`);

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when repoId is not a valid UUID", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost:3000/api/repos/not-a-uuid/reviews");

    const res = await GET(req, { params: Promise.resolve({ repoId: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_request");
  });

  it("returns 400 on invalid query params (e.g. negative page or excessive limit)", async () => {
    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost:3000/api/repos/${validRepoId}/reviews?page=-1&limit=500`
    );

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_request");
  });

  it("returns 404 when repo does not exist or belongs to another user (identical response)", async () => {
    mockRepos = []; // repo not found under current user due to RLS
    const { GET } = await import("./route");
    const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/reviews`);

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns paginated review history with default limits", async () => {
    mockReviews = Array.from({ length: 25 }, (_, i) => ({
      id: `rev-${i}`,
      repo_id: validRepoId,
      pr_number: i + 1,
      pr_title: `PR ${i + 1}`,
      pr_author: `author-${i}`,
      head_sha: `sha-${i}`,
      risk_score: 50,
      severity_counts: { critical: 0, warning: 1, suggestion: 0, praise: 0 },
      inline_comment_count: 1,
      review_duration_ms: 1200,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost:3000/api/repos/${validRepoId}/reviews?page=1&limit=20`
    );

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(25);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.reviews).toHaveLength(20);
  });
});
