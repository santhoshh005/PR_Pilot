/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockUser: { id: string; user_metadata?: Record<string, unknown>; email?: string } | null = null;
const mockRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
  usePathname: () => "/dashboard",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => {
        if (!mockUser) return { data: { user: null }, error: new Error("Not logged in") };
        return { data: { user: mockUser }, error: null };
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: [] }),
      })),
    })),
  })),
}));

describe("DashboardLayout", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      id: "user-123",
      email: "developer@example.com",
      user_metadata: { user_name: "devuser", avatar_url: "https://avatar.url/pic.png" },
    };
  });

  it("redirects to /login when user is not signed in", async () => {
    mockUser = null;
    const { default: DashboardLayout } = await import("./layout");

    await DashboardLayout({ children: <div>Child Content</div> });
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("renders header, sidebar, and child content when signed in", async () => {
    const { default: DashboardLayout } = await import("./layout");

    const Component = await DashboardLayout({
      children: <div data-testid="test-child">Dashboard Main Content</div>,
    });

    render(Component);

    expect(screen.getByTestId("test-child")).toBeDefined();
    expect(screen.getByText("Dashboard Main Content")).toBeDefined();
    expect(screen.getAllByText("PRPilot").length).toBeGreaterThan(0);
    expect(screen.getByText("Repositories")).toBeDefined();
    expect(screen.getByText("Sign Out")).toBeDefined();
  });
});
