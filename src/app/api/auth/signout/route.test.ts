import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import * as rateLimitMod from "@/lib/rate-limit";

const mockSignOut = vi.fn();
const mockUserClient = {
  auth: {
    signOut: mockSignOut,
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(() => Promise.resolve(mockUserClient)),
}));

describe("Sign Out Route Handler (/api/auth/signout)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports POST handler and does NOT export GET handler", async () => {
    const route = await import("./route");
    expect(route.POST).toBeDefined();
    expect(typeof route.POST).toBe("function");
    expect((route as any).GET).toBeUndefined();
  });

  it("calls signOut on the user client and redirects safely to / with 303", async () => {
    mockSignOut.mockResolvedValueOnce({ error: null });

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/auth/signout", {
      method: "POST",
    });

    const response = await POST(req);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    vi.spyOn(rateLimitMod, "checkAuthRateLimit").mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60000),
      retryAfter: 60,
    });

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/auth/signout", {
      method: "POST",
    });

    const response = await POST(req);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("redirects safely to /error?error=signout_failed when signOut throws", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("Supabase auth error"));

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/auth/signout", {
      method: "POST",
    });

    const response = await POST(req);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/error?error=signout_failed"
    );
  });
});
