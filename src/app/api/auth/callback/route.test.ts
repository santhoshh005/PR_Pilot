import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockExchangeCodeForSession = vi.fn();
const mockUserClient = {
  auth: {
    exchangeCodeForSession: mockExchangeCodeForSession,
  },
};

const mockUpsert = vi.fn();
const mockFrom = vi.fn(() => ({
  upsert: mockUpsert,
}));
const mockServiceClient = {
  from: mockFrom,
};

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(() => Promise.resolve(mockUserClient)),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => mockServiceClient),
}));

describe("Auth Callback Route Handler (GET /api/auth/callback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /error when code parameter is missing", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/auth/callback");

    const response = await GET(req);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("/error");
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to /error when exchangeCodeForSession returns an error", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error("Invalid authorization code"),
    });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=bad_code"
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("/error");
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("bad_code");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("exchanges code for session and upserts profile using service client then redirects to /dashboard", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "mock-token",
          provider_token: null,
          user: {
            id: "user-uuid-123",
            user_metadata: {
              provider_id: "12345678",
              user_name: "testuser",
              avatar_url: "https://github.com/testuser.png",
            },
          },
        },
        user: {
          id: "user-uuid-123",
          user_metadata: {
            provider_id: "12345678",
            user_name: "testuser",
            avatar_url: "https://github.com/testuser.png",
          },
        },
      },
      error: null,
    });

    mockUpsert.mockResolvedValueOnce({ error: null });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=good_code"
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe("http://localhost:3000/dashboard");

    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-uuid-123",
        github_user_id: 12345678,
        github_username: "testuser",
        avatar_url: "https://github.com/testuser.png",
      }),
      { onConflict: "id" }
    );
  });

  it("respects safe relative 'next' parameter", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: "user-uuid-123",
            user_metadata: {
              provider_id: "12345678",
              user_name: "testuser",
              avatar_url: "https://github.com/testuser.png",
            },
          },
        },
        user: {
          id: "user-uuid-123",
          user_metadata: {
            provider_id: "12345678",
            user_name: "testuser",
            avatar_url: "https://github.com/testuser.png",
          },
        },
      },
      error: null,
    });
    mockUpsert.mockResolvedValueOnce({ error: null });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=good_code&next=/settings"
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/settings"
    );
  });

  it("ignores unsafe external 'next' parameter and falls back to /dashboard", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: "user-uuid-123",
            user_metadata: {
              provider_id: "12345678",
              user_name: "testuser",
            },
          },
        },
        user: {
          id: "user-uuid-123",
          user_metadata: {
            provider_id: "12345678",
            user_name: "testuser",
          },
        },
      },
      error: null,
    });
    mockUpsert.mockResolvedValueOnce({ error: null });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=good_code&next=https://attacker.com"
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard"
    );
  });

  it("fetches user data with provider_token if present", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          provider_token: "gho_mock_provider_token",
          user: {
            id: "user-uuid-456",
            user_metadata: {},
          },
        },
        user: {
          id: "user-uuid-456",
          user_metadata: {},
        },
      },
      error: null,
    });
    mockUpsert.mockResolvedValueOnce({ error: null });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 98765432,
          login: "octocat_live",
          avatar_url: "https://github.com/octocat.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=good_code"
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer gho_mock_provider_token",
        }),
      })
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-uuid-456",
        github_user_id: 98765432,
        github_username: "octocat_live",
        avatar_url: "https://github.com/octocat.png",
      }),
      { onConflict: "id" }
    );

    fetchSpy.mockRestore();
  });
});
