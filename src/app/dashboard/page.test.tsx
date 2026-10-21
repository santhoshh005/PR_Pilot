/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockUser: { id: string } | null = null;
let mockReposData: Record<string, unknown>[] = [];
let mockReviewsData: Record<string, unknown>[] = [];
let mockDbError: Error | null = null;
const mockRedirect = vi.fn();
const mockLimitFn = vi.fn();
const mockOrderFn = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => {
        if (!mockUser) return { data: { user: null }, error: new Error("Not logged in") };
        return { data: { user: mockUser }, error: null };
      }),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        order: vi.fn((col: string, opts?: Record<string, unknown>) => {
          mockOrderFn(table, col, opts);
          return {
            limit: vi.fn(async (limitVal: number) => {
              mockLimitFn(table, limitVal);
              if (mockDbError) return { data: null, error: mockDbError };
              return { data: table === "repos" ? mockReposData : mockReviewsData, error: null };
            }),
            then: (resolve: (val: unknown) => void) => {
              if (mockDbError) return resolve({ data: null, error: mockDbError });
              return resolve({ data: mockReposData, error: null });
            },
          };
        }),
        in: vi.fn(() => ({
          order: vi.fn((col: string, opts?: Record<string, unknown>) => {
            mockOrderFn(table, col, opts);
            return {
              limit: vi.fn(async (limitVal: number) => {
                mockLimitFn(table, limitVal);
                if (mockDbError) return { data: null, error: mockDbError };
                return { data: mockReviewsData, error: null };
              }),
            };
          }),
        })),
        then: (resolve: (val: unknown) => void) => {
          if (mockDbError) return resolve({ data: null, error: mockDbError });
          if (table === "repos") return resolve({ data: mockReposData, error: null });
          if (table === "reviews") return resolve({ data: mockReviewsData, error: null });
          return resolve({ data: [], error: null });
        },
      })),
    })),
  })),
}));

describe("Dashboard Page (RSC)", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: "user-123" };
    mockDbError = null;
    mockReposData = [];
    mockReviewsData = [];
  });

  it("redirects to /login when user is not logged in", async () => {
    mockUser = null;
    const { default: DashboardPage } = await import("./page");

    await DashboardPage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("renders empty state when user has no connected repositories", async () => {
    mockReposData = [];
    const { default: DashboardPage } = await import("./page");

    const Component = await DashboardPage();
    render(Component);

    expect(screen.getByText("No repositories found")).toBeDefined();
    expect(
      screen.getByText(/You haven't connected any repositories yet/i)
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Sync Repositories/i })).toBeDefined();
  });

  it("renders install link in empty state when NEXT_PUBLIC_GITHUB_APP_INSTALL_URL is configured", async () => {
    process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL = "https://github.com/apps/prpilot-test/installations/new";
    mockReposData = [];
    const { default: DashboardPage } = await import("./page");

    const Component = await DashboardPage();
    render(Component);

    const installLink = screen.getByRole("link", { name: /Install GitHub App/i });
    expect(installLink).toBeDefined();
    expect(installLink.getAttribute("href")).toBe("https://github.com/apps/prpilot-test/installations/new");

    delete process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL;
  });

  it("renders repository cards when repositories exist", async () => {
    mockReposData = [
      {
        id: "repo-1",
        full_name: "facebook/react",
        owner: "facebook",
        name: "react",
        is_active: true,
        created_at: "2026-10-20T10:00:00Z",
      },
      {
        id: "repo-2",
        full_name: "vercel/next.js",
        owner: "vercel",
        name: "next.js",
        is_active: false,
        created_at: "2026-10-20T11:00:00Z",
      },
    ];

    mockReviewsData = [
      {
        repo_id: "repo-1",
        risk_score: 20,
        created_at: "2026-10-20T11:00:00Z",
      },
      {
        repo_id: "repo-1",
        risk_score: 40,
        created_at: "2026-10-20T12:00:00Z",
      },
    ];

    const { default: DashboardPage } = await import("./page");
    const Component = await DashboardPage();
    render(Component);

    expect(screen.getByText("facebook/react")).toBeDefined();
    expect(screen.getByText("vercel/next.js")).toBeDefined();
    expect(screen.getByText(/2 reviews/i)).toBeDefined();
    expect(screen.getByText(/Risk: 30/i)).toBeDefined(); // average of 20 and 40
  });

  it("renders generic error state when fetching fails without leaking DB errors", async () => {
    mockDbError = new Error("FATAL database internal connection timeout postgres://user:pass@host");
    const { default: DashboardPage } = await import("./page");

    const Component = await DashboardPage();
    render(Component);

    expect(screen.getByText("Unable to load repositories")).toBeDefined();
    expect(screen.queryByText(/postgres:/i)).toBeNull();
    expect(screen.queryByText(/timeout/i)).toBeNull();
  });

  it("bounds the review aggregation query with a hard cap of 1000 reviews ordered newest first", async () => {
    mockReposData = [
      {
        id: "repo-1",
        full_name: "test/repo",
        owner: "test",
        name: "repo",
        is_active: true,
        created_at: new Date().toISOString(),
      },
    ];

    const { default: DashboardPage } = await import("./page");
    await DashboardPage();

    expect(mockOrderFn).toHaveBeenCalledWith("reviews", "created_at", { ascending: false });
    expect(mockLimitFn).toHaveBeenCalledWith("reviews", 1000);
  });
});
