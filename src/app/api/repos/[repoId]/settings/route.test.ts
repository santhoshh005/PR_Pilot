import { describe, it, expect, vi, beforeEach } from "vitest";

let currentUser: { id: string } | null = null;
let mockRepos: Record<string, unknown>[] = [];
let mockSettings: Record<string, unknown> | null = null;

const mockUserClient = {
  auth: {
    getUser: vi.fn(async () => {
      if (!currentUser) {
        return { data: { user: null }, error: new Error("Not authenticated") };
      }
      return { data: { user: currentUser }, error: null };
    }),
  },
  from: (table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let pendingUpdate: Record<string, unknown> | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder mock chaining interface
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val);
        return chain;
      },
      update: (val: Record<string, unknown>) => {
        pendingUpdate = val;
        return chain;
      },
      maybeSingle: async () => {
        if (table === "repos") {
          const rows = mockRepos.filter((r) => filters.every((f) => f(r)));
          return { data: rows[0] || null, error: null };
        }
        if (table === "repo_settings") {
          if (pendingUpdate) {
            if (!mockSettings) return { data: null, error: null };
            Object.assign(mockSettings, pendingUpdate);
            return { data: mockSettings, error: null };
          }
          return { data: mockSettings, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (val: unknown) => void) => {
        if (table === "repos") {
          const rows = mockRepos.filter((r) => filters.every((f) => f(r)));
          return resolve({ data: rows, error: null });
        }
        if (table === "repo_settings") {
          return resolve({ data: mockSettings, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => mockUserClient),
}));

describe("Repo Settings Route Handler (/api/repos/[repoId]/settings)", () => {
  const validRepoId = "11111111-1111-4111-a111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "user-uuid-1" };
    mockRepos = [{ id: validRepoId }];
    mockSettings = {
      id: "settings-uuid-1",
      repo_id: validRepoId,
      ignored_paths: ["*.md"],
      strictness: "balanced",
      custom_instructions: "Default rules",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  describe("GET /api/repos/[repoId]/settings", () => {
    it("returns 401 when user is not signed in", async () => {
      currentUser = null;
      const { GET } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`);

      const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("unauthorized");
    });

    it("returns 400 when repoId is not a valid UUID", async () => {
      const { GET } = await import("./route");
      const req = new Request("http://localhost:3000/api/repos/invalid/settings");

      const res = await GET(req, { params: Promise.resolve({ repoId: "invalid" }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("returns 404 when repo does not exist or belongs to another user (identical response)", async () => {
      mockRepos = [];
      const { GET } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`);

      const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("returns repo settings for the authenticated owner", async () => {
      const { GET } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`);

      const res = await GET(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings).toBeDefined();
      expect(body.settings.strictness).toBe("balanced");
      expect(body.settings.custom_instructions).toBe("Default rules");
    });
  });

  describe("PATCH /api/repos/[repoId]/settings", () => {
    it("returns 401 when user is not signed in", async () => {
      currentUser = null;
      const { PATCH } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ strictness: "strict" }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("unauthorized");
    });

    it("returns 404 when repo does not exist or belongs to another user", async () => {
      mockRepos = [];
      const { PATCH } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ strictness: "strict" }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("returns 400 when strictness has an invalid value", async () => {
      const { PATCH } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ strictness: "extreme" }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("returns 400 when custom_instructions exceeds 2000 characters", async () => {
      const { PATCH } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ custom_instructions: "a".repeat(2001) }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("returns 400 when ignored_paths exceeds 100 patterns", async () => {
      const { PATCH } = await import("./route");
      const patterns = Array.from({ length: 101 }, (_, i) => `path-${i}`);
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ ignored_paths: patterns }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("returns 400 when any single ignored_paths pattern exceeds 300 characters", async () => {
      const { PATCH } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ ignored_paths: ["a".repeat(301)] }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("returns 400 and rejects unknown fields (e.g. repo_id or ownership manipulation)", async () => {
      const { PATCH } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          strictness: "strict",
          repo_id: "00000000-0000-0000-0000-000000000000",
        }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("successfully updates allowed settings and returns updated record", async () => {
      const { PATCH } = await import("./route");
      const req = new Request(`http://localhost:3000/api/repos/${validRepoId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          strictness: "strict",
          custom_instructions: "Prioritize security vulnerabilities",
          ignored_paths: ["dist/**", "*.min.js"],
        }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ repoId: validRepoId }) });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.settings).toBeDefined();
      expect(body.settings.strictness).toBe("strict");
      expect(body.settings.custom_instructions).toBe(
        "Prioritize security vulnerabilities"
      );
      expect(body.settings.ignored_paths).toEqual(["dist/**", "*.min.js"]);
    });
  });
});
