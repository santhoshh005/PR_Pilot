/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGetUser = vi.fn();
const mockRedirect = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

describe("LoginPage", { timeout: 15000 }, () => {
  // Pay the cold module-graph import once, outside per-test timeouts, so the first
  // test doesn't time out when the full suite runs across many parallel workers.
  beforeAll(async () => {
    await import("./page");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /dashboard if user is already logged in", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "test-user-id" } },
      error: null,
    });

    const { default: LoginPage } = await import("./page");
    await LoginPage();

    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders login card and Continue with GitHub button when user is not logged in", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const { default: LoginPage } = await import("./page");
    const Component = await LoginPage();
    render(Component);

    expect(screen.getByText("Sign in to PRPilot")).toBeDefined();
    expect(screen.getByRole("button", { name: /Continue with GitHub/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /Back to Homepage/i })).toBeDefined();
  });
});
