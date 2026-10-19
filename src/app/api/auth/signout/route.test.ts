import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSignOut = vi.fn();
const mockUserClient = {
  auth: {
    signOut: mockSignOut,
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(() => Promise.resolve(mockUserClient)),
}));

describe("Sign Out Route Handler (POST /api/auth/signout)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls signOut on the user client and redirects to /", async () => {
    mockSignOut.mockResolvedValueOnce({ error: null });

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/auth/signout", {
      method: "POST",
    });

    const response = await POST(req);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect([302, 303, 307]).toContain(response.status);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
