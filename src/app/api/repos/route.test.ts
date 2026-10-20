import { describe, it, expect, vi, beforeEach } from "vitest";

let currentUser: { id: string } | null = null;
let mockReposData: Record<string, unknown>[] = [];
let mockReviewsData: Record<string, unknown>[] = [];

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
    let orderCol: string | null = null;
    let isAsc = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder mock chaining interface
    const chain: any = {
      select: () => chain,
      order: (col: string, options?: { ascending?: boolean }) => {
        orderCol = col;
        isAsc = options?.ascending ?? true;
        return chain;
      },
      then: (resolve: (val: unknown) => void) => {
        if (table === "repos") {
          const sorted = [...mockReposData];
          if (orderCol) {
            sorted.sort((a, b) => {
              const valA = String(a[orderCol!] ?? "");
              const valB = String(b[orderCol!] ?? "");
              return isAsc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
            });
          }
          return resolve({ data: sorted, error: null });
        }
        if (table === "reviews") {
          return resolve({ data: mockReviewsData, error: null });
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

describe("GET /api/repos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "user-uuid-1" };
    mockReposData = [];
    mockReviewsData = [];
  });

  it("returns 401 when user is not signed in", async () => {
    currentUser = null;
    const { GET } = await import("./route");
    const req = new Request("http://localhost:3000/api/repos");

    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns empty array when user has no repositories", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost:3000/api/repos");

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ repos: [] });
  });

  it("returns repositories with aggregated review stats", async () => {
    mockReposData = [
      {
        id: "repo-uuid-1",
        full_name: "owner/repo-1",
        owner: "owner",
        name: "repo-1",
        is_active: true,
      },
      {
        id: "repo-uuid-2",
        full_name: "owner/repo-2",
        owner: "owner",
        name: "repo-2",
        is_active: true,
      },
    ];

    mockReviewsData = [
      {
        repo_id: "repo-uuid-1",
        risk_score: 40,
        created_at: "2026-10-18T10:00:00Z",
      },
      {
        repo_id: "repo-uuid-1",
        risk_score: 80,
        created_at: "2026-10-19T12:00:00Z",
      },
    ];

    const { GET } = await import("./route");
    const req = new Request("http://localhost:3000/api/repos");

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.repos).toHaveLength(2);
    const r1 = body.repos.find((r: { id: string }) => r.id === "repo-uuid-1");
    expect(r1).toBeDefined();
    expect(r1.total_reviews).toBe(2);
    expect(r1.avg_risk_score).toBe(60);
    expect(r1.last_review_at).toBe("2026-10-19T12:00:00Z");

    const r2 = body.repos.find((r: { id: string }) => r.id === "repo-uuid-2");
    expect(r2).toBeDefined();
    expect(r2.total_reviews).toBe(0);
    expect(r2.avg_risk_score).toBeNull();
    expect(r2.last_review_at).toBeNull();
  });

  it("returns 429 with Retry-After when dashboard rate limit is exceeded", async () => {
    const rateLimitMod = await import("@/lib/rate-limit");
    vi.spyOn(rateLimitMod, "checkDashboardRateLimit").mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 50000),
      retryAfter: 50,
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost:3000/api/repos");

    const res = await GET(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("50");
    const body = await res.json();
    expect(body).toEqual({
      error: "rate_limited",
      message: "Too many requests. Please try again later.",
      status: 429,
    });
  });
});
