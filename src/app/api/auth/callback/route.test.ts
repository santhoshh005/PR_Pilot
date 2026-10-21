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

  it("rejects authentication if verified GitHub provider identity is missing (does not trust user_metadata)", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "mock-token",
          provider_token: null,
          user: {
            id: "unverified-user-123",
            // Attacker puts spoofed GitHub details in user_metadata:
            user_metadata: {
              provider_id: "99999999",
              user_name: "spoofed_target_admin",
            },
            identities: [], // NO verified github identity
          },
        },
        user: {
          id: "unverified-user-123",
          user_metadata: {
            provider_id: "99999999",
            user_name: "spoofed_target_admin",
          },
          identities: [],
        },
      },
      error: null,
    });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=unverified_code"
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("/error?error=missing_github_profile");
    // Database must not have been upserted with unverified metadata
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("exchanges code for session and upserts profile from verified identities then redirects to /dashboard", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "mock-token",
          provider_token: null,
          user: {
            id: "user-uuid-123",
            identities: [
              {
                provider: "github",
                id: "12345678",
                identity_data: {
                  provider_id: "12345678",
                  user_name: "testuser",
                  avatar_url: "https://github.com/testuser.png",
                },
              },
            ],
          },
        },
        user: {
          id: "user-uuid-123",
          identities: [
            {
              provider: "github",
              id: "12345678",
              identity_data: {
                provider_id: "12345678",
                user_name: "testuser",
                avatar_url: "https://github.com/testuser.png",
              },
            },
          ],
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
            identities: [
              {
                provider: "github",
                id: "12345678",
                identity_data: {
                  provider_id: "12345678",
                  user_name: "testuser",
                },
              },
            ],
          },
        },
        user: {
          id: "user-uuid-123",
          identities: [
            {
              provider: "github",
              id: "12345678",
              identity_data: {
                provider_id: "12345678",
                user_name: "testuser",
              },
            },
          ],
        },
      },
      error: null,
    });
    mockUpsert.mockResolvedValueOnce({ error: null });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=good_code&next=/settings?tab=general"
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/settings?tab=general"
    );
  });

  it("ignores unsafe external and malformed 'next' parameters and falls back to /dashboard", async () => {
    const maliciousCases = [
      "https://attacker.com",
      "//attacker.com",
      "/\\attacker.com",
      "\\attacker.com",
      "/settings\\evil.com",
      "javascript:alert(1)",
    ];

    const { GET } = await import("./route");

    for (const badNext of maliciousCases) {
      mockExchangeCodeForSession.mockResolvedValueOnce({
        data: {
          session: {
            user: {
              id: "user-uuid-123",
              identities: [
                {
                  provider: "github",
                  id: "12345678",
                  identity_data: {
                    provider_id: "12345678",
                    user_name: "testuser",
                  },
                },
              ],
            },
          },
          user: {
            id: "user-uuid-123",
            identities: [
              {
                provider: "github",
                id: "12345678",
                identity_data: {
                  provider_id: "12345678",
                  user_name: "testuser",
                },
              },
            ],
          },
        },
        error: null,
      });
      mockUpsert.mockResolvedValueOnce({ error: null });

      const req = new NextRequest(
        `http://localhost:3000/api/auth/callback?code=good_code&next=${encodeURIComponent(badNext)}`
      );

      const response = await GET(req);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/dashboard"
      );
    }
  });

  it("ignores X-Forwarded-Host header and always redirects to trusted NEXT_PUBLIC_APP_URL origin", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: "user-uuid-123",
            identities: [
              {
                provider: "github",
                id: "12345678",
                identity_data: {
                  provider_id: "12345678",
                  user_name: "testuser",
                },
              },
            ],
          },
        },
        user: {
          id: "user-uuid-123",
          identities: [
            {
              provider: "github",
              id: "12345678",
              identity_data: {
                provider_id: "12345678",
                user_name: "testuser",
              },
            },
          ],
        },
      },
      error: null,
    });
    mockUpsert.mockResolvedValueOnce({ error: null });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/auth/callback?code=good_code",
      {
        headers: {
          "x-forwarded-host": "evil-phishing-site.com",
          host: "evil-phishing-site.com",
        },
      }
    );

    const response = await GET(req);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe("http://localhost:3000/dashboard");
    expect(location).not.toContain("evil-phishing-site.com");
  });

  it("fetches user data with provider_token if present", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          provider_token: "gho_mock_provider_token",
          user: {
            id: "user-uuid-456",
            identities: [
              {
                provider: "github",
                id: "98765432",
              },
            ],
          },
        },
        user: {
          id: "user-uuid-456",
          identities: [
            {
              provider: "github",
              id: "98765432",
            },
          ],
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

  it("returns 429 with Retry-After when auth rate limit is exceeded", async () => {
    const rateLimitMod = await import("@/lib/rate-limit");
    vi.spyOn(rateLimitMod, "checkAuthRateLimit").mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60000),
      retryAfter: 60,
    });

    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/auth/callback?code=some_code");

    const res = await GET(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const json = await res.json();
    expect(json).toEqual({
      error: "rate_limited",
      message: "Too many requests. Please try again later.",
      status: 429,
    });
  });
});
