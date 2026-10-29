/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

describe("HomePage (Landing Page)", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders landing page for unauthenticated visitors with accurate claims", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const { default: HomePage } = await import("./page");
    const Component = await HomePage();
    const { container } = render(Component);

    // Header & Hero
    expect(screen.getAllByRole("link", { name: /Sign in with GitHub/i })).toHaveLength(2);
    expect(screen.getByText("High-signal code reviews, automatically delivered.")).toBeDefined();

    // Feature 1: Verified Line Comments
    expect(screen.getByText("Verified Line Comments")).toBeDefined();
    expect(
      screen.getByText(/Every inline comment is checked against the diff before posting; comments that do not match are moved to the summary/i)
    ).toBeDefined();
    expect(container.textContent).not.toContain("Zero misplaced comments");

    // Feature 2: Gemini Intelligence with correct severities
    expect(screen.getByText("Gemini Intelligence")).toBeDefined();
    expect(
      screen.getByText(/critical, warning, suggestion, praise/i)
    ).toBeDefined();
    expect(container.textContent).not.toContain("nitpick");

    // Feature 3: Custom Strictness
    expect(screen.getByText("Custom Strictness")).toBeDefined();
    expect(
      screen.getByText(/Configure ignored paths, custom instructions, and review strictness/i)
    ).toBeDefined();
  });

  it("renders dashboard links for authenticated users", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "test-user-id" } },
      error: null,
    });

    const { default: HomePage } = await import("./page");
    const Component = await HomePage();
    render(Component);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeDefined();
    expect(screen.getByRole("link", { name: /Go to Dashboard →/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Sign Out/i })).toBeDefined();
  });
});
