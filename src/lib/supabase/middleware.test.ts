import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { updateSession } from "./middleware";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

describe("updateSession", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("passes through immediately for /api/webhook without checking user auth", async () => {
    const request = new NextRequest("http://localhost:3000/api/webhook");

    const response = await updateSession(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("passes through immediately for /api/cron/* without checking user auth", async () => {
    const request = new NextRequest("http://localhost:3000/api/cron/process-reviews");

    const response = await updateSession(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated users from /dashboard to /login", async () => {
    const request = new NextRequest("http://localhost:3000/dashboard");

    const mockGetUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error("Not logged in"),
    });
    const mockGetSession = vi.fn();

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getUser: mockGetUser,
        getSession: mockGetSession,
      },
    } as unknown as ReturnType<typeof createServerClient>);

    const response = await updateSession(request);

    expect(mockGetUser).toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(response.status).toBe(307); // Next.js temporary redirect
    const location = response.headers.get("location");
    expect(location).toContain("/login");
  });

  it("redirects unauthenticated users from /dashboard/repo-1 to /login", async () => {
    const request = new NextRequest("http://localhost:3000/dashboard/repo-1");

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as unknown as ReturnType<typeof createServerClient>);

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("/login");
  });

  it("allows authenticated users to access /dashboard", async () => {
    const request = new NextRequest("http://localhost:3000/dashboard");

    const mockGetUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "test-user-id",
          email: "user@example.com",
        },
      },
      error: null,
    });

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getUser: mockGetUser,
      },
    } as unknown as ReturnType<typeof createServerClient>);

    const response = await updateSession(request);

    expect(mockGetUser).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("configures cookies with getAll and setAll and preserves them", async () => {
    const request = new NextRequest("http://localhost:3000/dashboard", {
      headers: {
        cookie: "sb-auth-token=abc123",
      },
    });

    let capturedOptions: Parameters<typeof createServerClient>[2] | undefined;
    vi.mocked(createServerClient).mockImplementation((url, key, opts) => {
      capturedOptions = opts;
      return {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "test-user-id" } },
            error: null,
          }),
        },
      } as unknown as ReturnType<typeof createServerClient>;
    });

    await updateSession(request);

    expect(capturedOptions).toBeDefined();
    const cookiesOption = capturedOptions!.cookies;

    // Test getAll
    const cookies = await cookiesOption.getAll();
    expect(Array.isArray(cookies)).toBe(true);
    expect(
      cookies && cookies.some((c: { name: string; value: string }) => c.name === "sb-auth-token")
    ).toBe(true);

    // Test setAll
    if (cookiesOption.setAll) {
      cookiesOption.setAll(
        [{ name: "sb-refreshed", value: "newToken", options: { path: "/" } }],
        {}
      );
    }
    expect(request.cookies.get("sb-refreshed")?.value).toBe("newToken");
  });
});
