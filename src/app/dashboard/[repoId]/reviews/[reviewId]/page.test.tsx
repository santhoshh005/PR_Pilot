/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockUser: { id: string } | null = null;
let mockRepoData: any = null;
let mockReviewData: any = null;
let mockCommentsData: any[] = [];
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
              eq: vi.fn(() => ({
                single: vi.fn(async () => {
                  if (mockDbError) return { data: null, error: mockDbError };
                  if (!mockReviewData) return { data: null, error: { code: "PGRST116" } };
                  return { data: mockReviewData, error: null };
                }),
              })),
            })),
          })),
        };
      }

      if (table === "review_comments") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => {
              if (mockDbError) return { data: null, error: mockDbError };
              return { data: mockCommentsData, error: null };
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

describe("Review Detail Page (RSC)", { timeout: 15000 }, () => {
  const validRepoId = "33333333-4444-4555-8666-777777777777";
  const validReviewId = "44444444-5555-4666-8777-888888888888";

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: "user-123" };
    mockRepoData = null;
    mockReviewData = null;
    mockCommentsData = [];
    mockDbError = null;
  });

  it("redirects to /login when user is not authenticated", async () => {
    mockUser = null;
    const { default: ReviewPage } = await import("./page");

    await expect(
      ReviewPage({
        params: Promise.resolve({ repoId: validRepoId, reviewId: validReviewId }),
      })
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("triggers notFound when IDs are not valid UUIDs", async () => {
    const { default: ReviewPage } = await import("./page");

    await expect(
      ReviewPage({
        params: Promise.resolve({ repoId: "invalid", reviewId: validReviewId }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("renders review and comments when review exists", async () => {
    mockRepoData = { id: validRepoId, full_name: "facebook/react" };
    mockReviewData = {
      id: validReviewId,
      repo_id: validRepoId,
      pr_number: 99,
      pr_title: "Add concurrency features",
      pr_author: "acdlite",
      head_sha: "1234567890ab",
      summary: "Detailed review summary text.",
      risk_score: 15,
      severity_counts: { critical: 0, warning: 1, suggestion: 0, praise: 1 },
      created_at: "2026-10-20T10:00:00Z",
    };
    mockCommentsData = [
      {
        id: "comm-1",
        review_id: validReviewId,
        file_path: "src/concurrency.ts",
        line_number: 45,
        side: "RIGHT",
        severity: "warning",
        title: "Potential race condition",
        body: "Ensure atomic update.",
        suggestion: "await updateAtomic();",
      },
    ];

    const { default: ReviewPage } = await import("./page");
    const Component = await ReviewPage({
      params: Promise.resolve({ repoId: validRepoId, reviewId: validReviewId }),
    });

    render(Component);

    expect(screen.getByText(/#99 Add concurrency features/i)).toBeDefined();
    expect(screen.getByText("Detailed review summary text.")).toBeDefined();
    expect(screen.getByText("Potential race condition")).toBeDefined();
    expect(screen.getByText("src/concurrency.ts:45")).toBeDefined();
    expect(screen.getByText("await updateAtomic();")).toBeDefined();
  });
});
