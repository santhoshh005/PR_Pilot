import { describe, it, expect, vi, beforeEach } from "vitest";

let currentUser: { id: string } | null = null;
let mockRepos: any[] = [];
let mockReviews: any[] = [];

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
    let filters: Array<(row: any) => boolean> = [];
    let limitVal: number | null = null;

    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => {
        filters.push((row) => row[col] === val);
        return chain;
      },
      gte: (col: string, val: any) => {
        filters.push((row) => row[col] >= val);
        return chain;
      },
      order: () => chain,
      limit: (n: number) => {
        limitVal = n;
        return chain;
      },
      maybeSingle: async () => {
        const rows = mockRepos.filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] || null, error: null };
      },
      then: (resolve: any) => {
        if (table === "repos") {
          let rows = mockRepos.filter((r) => filters.every((f) => f(r)));
          if (limitVal !== null) rows = rows.slice(0, limitVal);
          return resolve({ data: rows, error: null });
        }
        if (table === "reviews") {
          let rows = mockReviews.filter((r) => filters.every((f) => f(r)));
          if (limitVal !== null) rows = rows.slice(0, limitVal);
          return resolve({ data: rows, error: null });
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

describe("GET /api/repos/[repoId]/stats", () => {
  const validRepoId = "11111111-1111-4111-a111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "user-uuid-1" };
    mockRepos = [{ id: validRepoId }];
    mockReviews = [];
  });

  it("returns 401 when user is not signed in", async () => {
    currentUser = null;
    const { GET } = await import("./route");
    const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/stats`);

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when repoId is not a valid UUID", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost:3000/api/repos/invalid-id/stats");

    const res = await GET(req, { params: Promise.resolve({ repoId: "invalid-id" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_request");
  });

  it("returns 400 when days param exceeds max 90 or is negative", async () => {
    const { GET } = await import("./route");
    const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/stats?days=120`);

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_request");
  });

  it("returns 404 when repo does not exist or belongs to another user (identical response)", async () => {
    mockRepos = [];
    const { GET } = await import("./route");
    const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/stats`);

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns correctly aggregated stats for severity breakdown and risk trend", async () => {
    const today = "2026-10-20";
    const yesterday = "2026-10-19";

    mockReviews = [
      {
        id: "rev-1",
        repo_id: validRepoId,
        risk_score: 30,
        severity_counts: { critical: 1, warning: 2, suggestion: 0, praise: 1 },
        review_duration_ms: 1000,
        created_at: `${yesterday}T10:00:00Z`,
      },
      {
        id: "rev-2",
        repo_id: validRepoId,
        risk_score: 70,
        severity_counts: { critical: 0, warning: 1, suggestion: 3, praise: 0 },
        review_duration_ms: 2000,
        created_at: `${today}T11:00:00Z`,
      },
      {
        id: "rev-3",
        repo_id: validRepoId,
        risk_score: 90,
        severity_counts: { critical: 2, warning: 0, suggestion: 1, praise: 0 },
        review_duration_ms: 3000,
        created_at: `${today}T15:00:00Z`,
      },
    ];

    const { GET } = await import("./route");
    const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/stats?days=30`);

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total_reviews).toBe(3);
    expect(body.avg_review_duration_ms).toBe(2000); // (1000 + 2000 + 3000) / 3

    expect(body.severity_breakdown).toHaveLength(2);
    const todaySeverity = body.severity_breakdown.find((s: any) => s.date === today);
    expect(todaySeverity).toEqual({
      date: today,
      critical: 2,
      warning: 1,
      suggestion: 4,
      praise: 0,
    });

    expect(body.risk_trend).toHaveLength(2);
    const todayTrend = body.risk_trend.find((t: any) => t.date === today);
    expect(todayTrend).toEqual({
      date: today,
      avg_risk_score: 80, // (70 + 90) / 2
      review_count: 2,
    });
  });

  it("enforces a hard row cap of 1000 reviews on stats query", async () => {
    const today = "2026-10-20";
    // Generate 1200 reviews
    mockReviews = Array.from({ length: 1200 }, (_, i) => ({
      id: `rev-${i}`,
      repo_id: validRepoId,
      risk_score: 50,
      severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 0 },
      review_duration_ms: 1000,
      created_at: `${today}T12:00:00Z`,
    }));

    const { GET } = await import("./route");
    const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/stats?days=30`);

    const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Since query caps at 1000 rows, total_reviews should be exactly 1000
    expect(body.total_reviews).toBe(1000);
  });
});
