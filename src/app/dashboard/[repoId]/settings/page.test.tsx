/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockUser: { id: string } | null = null;
let mockRepoData: Record<string, unknown> | null = null;
let mockSettingsData: Record<string, unknown> | null = null;
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

      if (table === "repo_settings") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => {
                if (mockDbError) return { data: null, error: mockDbError };
                return { data: mockSettingsData, error: null };
              }),
            })),
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

describe("Repo Settings Page (RSC)", { timeout: 15000 }, () => {
  const validRepoId = "22222222-3333-4444-8555-666666666666";

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: "user-123" };
    mockRepoData = null;
    mockSettingsData = null;
    mockDbError = null;
  });

  it("redirects to /login when user is not authenticated", async () => {
    mockUser = null;
    const { default: SettingsPage } = await import("./page");

    await expect(
      SettingsPage({
        params: Promise.resolve({ repoId: validRepoId }),
      })
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("triggers notFound when repoId is not a valid UUID", async () => {
    const { default: SettingsPage } = await import("./page");

    await expect(
      SettingsPage({
        params: Promise.resolve({ repoId: "not-a-valid-uuid" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("triggers notFound when repository is missing or belongs to another user", async () => {
    mockRepoData = null;
    const { default: SettingsPage } = await import("./page");

    await expect(
      SettingsPage({
        params: Promise.resolve({ repoId: validRepoId }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("renders settings page and form when repository exists", async () => {
    mockRepoData = {
      id: validRepoId,
      full_name: "facebook/react",
      name: "react",
      owner: "facebook",
      is_active: true,
      created_at: "2026-10-01T00:00:00Z",
    };
    mockSettingsData = {
      strictness: "strict",
      custom_instructions: "Strict TypeScript checking required.",
      ignored_paths: ["docs/**", "spec/**"],
    };

    const { default: SettingsPage } = await import("./page");
    const Component = await SettingsPage({
      params: Promise.resolve({ repoId: validRepoId }),
    });

    render(Component);

    expect(screen.getByText("Repository Settings")).toBeDefined();
    expect(screen.getAllByText("facebook/react").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/review strictness/i)).toBeDefined();
    expect(screen.getByLabelText(/custom instructions/i)).toBeDefined();
    expect(screen.getByLabelText(/ignored paths/i)).toBeDefined();
  });

  it("renders generic error state when fetching fails without leaking DB errors", async () => {
    mockDbError = new Error("FATAL database internal connection timeout postgres://user:pass@host");
    const { default: SettingsPage } = await import("./page");

    const Component = await SettingsPage({
      params: Promise.resolve({ repoId: validRepoId }),
    });

    render(Component);

    expect(screen.getByText("Unable to load settings")).toBeDefined();
    expect(screen.queryByText(/postgres:/i)).toBeNull();
    expect(screen.queryByText(/FATAL/i)).toBeNull();
  });
});
