/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockUser: { id: string } | null = null;
let mockRepoData: any = null;
let mockReviewsData: any[] = [];
let mockReviewCommentsData: any[] = [];
let mockReviewsCount: number = 0;
let mockDbError: Error | null = null;
const mockRedirect = vi.fn();
const mockNotFound = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    mockNotFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => {
        if (!mockUser) return { data: { user: null }, error: new Error("Not logged in") };
        return { data: { user: mockUser }, error: null };
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "repos") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => {
                if (mockDbError) return { data: null, error: mockDbError };
                if (!mockRepoData) return { data: null, error: { code: "PGRST116" } };
                return { data: mockRepoData, error: null };
              }),
            })),
          })),
        };
      }

      if (table === "reviews") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                range: vi.fn(async () => {
                  if (mockDbError) return { data: null, error: mockDbError, count: null };
                  return { data: mockReviewsData, error: null, count: mockReviewsCount };
                }),
              })),
            })),
          })),
        };
      }

      if (table === "review_comments") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => {
              if (mockDbError) return { data: null, error: mockDbError };
              return { data: mockReviewCommentsData, error: null };
            }),
          })),
        };
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [], error: null })),
        })),
      };
    }),
  })),
}));

describe("Repo Reviews Page (RSC)", { timeout: 15000 }, () => {
  const validRepoId = "11111111-2222-4333-8444-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: "user-123" };
    mockRepoData = null;
    mockReviewsData = [];
    mockReviewCommentsData = [];
    mockReviewsCount = 0;
    mockDbError = null;
  });

  it("redirects to /login when user is not authenticated", async () => {
    mockUser = null;
    const { default: RepoPage } = await import("./page");

    await expect(
      RepoPage({
        params: Promise.resolve({ repoId: validRepoId }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("triggers notFound when repoId is not a valid UUID", async () => {
    const { default: RepoPage } = await import("./page");

    await expect(
      RepoPage({
        params: Promise.resolve({ repoId: "not-a-uuid" }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("triggers notFound when repository is missing or belongs to another user", async () => {
    mockRepoData = null;
    const { default: RepoPage } = await import("./page");

    await expect(
      RepoPage({
        params: Promise.resolve({ repoId: validRepoId }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("renders repository header and review list when repository exists", async () => {
    mockRepoData = {
      id: validRepoId,
      full_name: "facebook/react",
      name: "react",
      owner: "facebook",
      is_active: true,
      created_at: "2026-10-01T00:00:00Z",
    };
    mockReviewsData = [
      {
        id: "rev-1",
        repo_id: validRepoId,
        pr_number: 100,
        pr_title: "Refactor hooks",
        pr_author: "gaearon",
        head_sha: "aabbccddeeff",
        summary: "Clean refactoring of hooks implementation.",
        risk_score: 25,
        severity_counts: { critical: 0, warning: 1, suggestion: 0, praise: 1 },
        inline_comment_count: 1,
        created_at: "2026-10-20T12:00:00Z",
      },
    ];
    mockReviewCommentsData = [
      {
        id: "comm-1",
        review_id: "rev-1",
        file_path: "packages/react/src/ReactHooks.js",
        line_number: 24,
        side: "RIGHT",
        severity: "warning",
        title: "Missing dependency in hook",
        body: "Check effect dependency array.",
      },
    ];
    mockReviewsCount = 1;

    const { default: RepoPage } = await import("./page");
    const Component = await RepoPage({
      params: Promise.resolve({ repoId: validRepoId }),
      searchParams: Promise.resolve({}),
    });

    render(Component);

    expect(screen.getByRole("heading", { name: "facebook/react" })).toBeDefined();
    expect(screen.getByText(/#100 Refactor hooks/i)).toBeDefined();
    expect(screen.getByText("gaearon")).toBeDefined();
    expect(screen.getByRole("link", { name: /settings/i })).toBeDefined();
  });

  it("renders generic error state when fetching fails without leaking DB errors", async () => {
    mockDbError = new Error("FATAL database internal connection timeout postgres://user:pass@host");
    const { default: RepoPage } = await import("./page");

    const Component = await RepoPage({
      params: Promise.resolve({ repoId: validRepoId }),
      searchParams: Promise.resolve({}),
    });

    render(Component);

    expect(screen.getByText("Unable to load reviews")).toBeDefined();
    expect(screen.queryByText(/postgres:/i)).toBeNull();
    expect(screen.queryByText(/FATAL/i)).toBeNull();
  });
});
