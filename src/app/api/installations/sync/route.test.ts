import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// Mock database state
interface MockProfile {
  id: string;
  github_user_id: number;
  github_username: string;
}

interface MockInstallation {
  id: string;
  installation_id: number;
  owner_id: string;
  account_login: string;
  account_type: string;
  suspended_at?: string | null;
}

interface MockRepo {
  id: string;
  installation_id: string;
  github_repo_id: number;
  owner: string;
  name: string;
  full_name: string;
  is_active: boolean;
  updated_at: string;
}

interface MockRepoSettings {
  id: string;
  repo_id: string;
  ignored_paths: string[];
  strictness: string;
  custom_instructions: string;
}

let mockDb: {
  profiles: MockProfile[];
  installations: MockInstallation[];
  repos: MockRepo[];
  repo_settings: MockRepoSettings[];
};

function resetDb() {
  mockDb = {
    profiles: [],
    installations: [],
    repos: [],
    repo_settings: [],
  };
}

let currentUser: { id: string } | null = null;

const mockGetUser = vi.fn(async () => {
  if (!currentUser) {
    return { data: { user: null }, error: new Error("Not logged in") };
  }
  return { data: { user: currentUser }, error: null };
});

const mockUserClient = {
  auth: {
    getUser: mockGetUser,
  },
};

function createMockServiceClient() {
  return {
    from: (table: string) => {
      const currentTable = ((mockDb as unknown as Record<string, Record<string, unknown>[]>)[table] || []) as Record<string, unknown>[];
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let isDelete = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder mock chaining interface
      const chain: any = {
        select: () => chain,
        eq: (field: string, value: unknown) => {
          filters.push((row) => row[field] === value);
          return chain;
        },
        single: async () => {
          const rows = currentTable.filter((row) =>
            filters.every((f) => f(row))
          );
          return { data: rows[0] || null, error: rows.length ? null : new Error("Not found") };
        },
        maybeSingle: async () => {
          const rows = currentTable.filter((row) =>
            filters.every((f) => f(row))
          );
          return { data: rows[0] || null, error: null };
        },
        delete: () => {
          isDelete = true;
          return chain;
        },
        upsert: (values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
          const onConflict = options?.onConflict;
          const ignoreDuplicates = options?.ignoreDuplicates;
          const rowsToUpsert = Array.isArray(values) ? values : [values];

          const upsertedRows: Record<string, unknown>[] = [];
          for (const item of rowsToUpsert) {
            const conflictKey = onConflict || "id";
            const existingIdx = currentTable.findIndex(
              (r) => r[conflictKey] === item[conflictKey]
            );

            if (existingIdx !== -1) {
              if (ignoreDuplicates) {
                upsertedRows.push(currentTable[existingIdx]);
              } else {
                currentTable[existingIdx] = {
                  ...currentTable[existingIdx],
                  ...item,
                };
                upsertedRows.push(currentTable[existingIdx]);
              }
            } else {
              const newRow = {
                id: item.id || `gen-${Math.random().toString(36).substring(2, 9)}`,
                ...item,
              };
              currentTable.push(newRow);
              upsertedRows.push(newRow);
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder mock chaining interface
          const upsertChain: any = {
            select: () => upsertChain,
            single: async () => ({
              data: upsertedRows[0] || null,
              error: null,
            }),
            then: (resolve: (val: unknown) => void) => resolve({ data: upsertedRows, error: null }),
          };
          return upsertChain;
        },
        then: (resolve: (val: unknown) => void) => {
          if (isDelete) {
            const toDelete = currentTable.filter((row) =>
              filters.every((f) => f(row))
            );
            (mockDb as unknown as Record<string, Record<string, unknown>[]>)[table] = currentTable.filter(
              (row) => !toDelete.includes(row)
            );
            return resolve({ data: toDelete, error: null });
          }
          const rows = currentTable.filter((row) =>
            filters.every((f) => f(row))
          );
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
}

const mockServiceClient = createMockServiceClient();

vi.mock("@/lib/supabase/server", () => ({
  createUserClient: vi.fn(async () => mockUserClient),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => mockServiceClient),
}));

const mockListInstallations = vi.fn();
const mockListReposAccessibleToInstallation = vi.fn();

vi.mock("@/lib/github/app", () => ({
  getAppOctokit: vi.fn(() => ({
    rest: {
      apps: {
        listInstallations: mockListInstallations,
      },
    },
  })),
  getInstallationOctokit: vi.fn(() => ({
    rest: {
      apps: {
        listReposAccessibleToInstallation: mockListReposAccessibleToInstallation,
      },
    },
  })),
}));

describe("POST /api/installations/sync", () => {
  const userAProfile: MockProfile = {
    id: "user-a-uuid",
    github_user_id: 1111,
    github_username: "user-a",
  };

  const userBProfile: MockProfile = {
    id: "user-b-uuid",
    github_user_id: 2222,
    github_username: "user-b",
  };

  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    mockDb.profiles.push(userAProfile, userBProfile);
    currentUser = { id: userAProfile.id };
  });

  it("returns 401 when the request is unauthenticated", async () => {
    currentUser = null;
    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/installations/sync", {
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("handles a user with no installations gracefully", async () => {
    mockListInstallations.mockResolvedValueOnce({
      data: [],
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/installations/sync", {
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ installations: 0, repos: 0 });
    expect(mockDb.installations.length).toBe(0);
    expect(mockDb.repos.length).toBe(0);
  });

  it("syncs one personal installation with several repos and default repo_settings", async () => {
    mockListInstallations.mockResolvedValueOnce({
      data: [
        {
          id: 501,
          target_type: "User",
          account: {
            id: 1111,
            login: "user-a",
            type: "User",
          },
        },
      ],
    });

    mockListReposAccessibleToInstallation.mockResolvedValueOnce({
      data: {
        total_count: 2,
        repositories: [
          {
            id: 1001,
            name: "repo-alpha",
            full_name: "user-a/repo-alpha",
            owner: { login: "user-a" },
          },
          {
            id: 1002,
            name: "repo-beta",
            full_name: "user-a/repo-beta",
            owner: { login: "user-a" },
          },
        ],
      },
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/installations/sync", {
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ installations: 1, repos: 2 });

    expect(mockDb.installations.length).toBe(1);
    expect(mockDb.installations[0].installation_id).toBe(501);
    expect(mockDb.installations[0].owner_id).toBe(userAProfile.id);

    expect(mockDb.repos.length).toBe(2);
    expect(mockDb.repo_settings.length).toBe(2);

    const setting = mockDb.repo_settings[0];
    expect(setting.strictness).toBe("balanced");
    expect(setting.ignored_paths).toEqual([]);
    expect(setting.custom_instructions).toBe("");
  });

  it("ignores organization installations and does not sync them", async () => {
    mockListInstallations.mockResolvedValueOnce({
      data: [
        {
          id: 601,
          target_type: "Organization",
          account: {
            id: 9999,
            login: "some-org",
            type: "Organization",
          },
        },
        {
          id: 501,
          target_type: "User",
          account: {
            id: 1111,
            login: "user-a",
            type: "User",
          },
        },
      ],
    });

    mockListReposAccessibleToInstallation.mockResolvedValueOnce({
      data: {
        total_count: 1,
        repositories: [
          {
            id: 1001,
            name: "repo-alpha",
            full_name: "user-a/repo-alpha",
            owner: { login: "user-a" },
          },
        ],
      },
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/installations/sync", {
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ installations: 1, repos: 1 });

    expect(mockDb.installations.length).toBe(1);
    expect(mockDb.installations[0].installation_id).toBe(501);
  });

  it("is idempotent when re-running sync and does not duplicate or overwrite modified settings", async () => {
    // 1. Initial sync
    mockListInstallations.mockResolvedValue({
      data: [
        {
          id: 501,
          target_type: "User",
          account: {
            id: 1111,
            login: "user-a",
            type: "User",
          },
        },
      ],
    });

    mockListReposAccessibleToInstallation.mockResolvedValue({
      data: {
        total_count: 1,
        repositories: [
          {
            id: 1001,
            name: "repo-alpha",
            full_name: "user-a/repo-alpha",
            owner: { login: "user-a" },
          },
        ],
      },
    });

    const { POST } = await import("./route");
    const req1 = new Request("http://localhost:3000/api/installations/sync", {
      method: "POST",
    });
    await POST(req1);

    expect(mockDb.installations.length).toBe(1);
    expect(mockDb.repos.length).toBe(1);
    expect(mockDb.repo_settings.length).toBe(1);

    // Modify user repo settings
    mockDb.repo_settings[0].strictness = "strict";
    mockDb.repo_settings[0].custom_instructions = "Focus on security";

    // 2. Re-run sync
    const req2 = new Request("http://localhost:3000/api/installations/sync", {
      method: "POST",
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual({ installations: 1, repos: 1 });

    // Assert counts are not duplicated
    expect(mockDb.installations.length).toBe(1);
    expect(mockDb.repos.length).toBe(1);
    expect(mockDb.repo_settings.length).toBe(1);

    // Assert existing customized settings were preserved
    expect(mockDb.repo_settings[0].strictness).toBe("strict");
    expect(mockDb.repo_settings[0].custom_instructions).toBe("Focus on security");
  });

  it("cleans up removed repos when GitHub no longer returns them", async () => {
    // 1. Initial sync with 2 repos
    mockListInstallations.mockResolvedValue({
      data: [
        {
          id: 501,
          target_type: "User",
          account: {
            id: 1111,
            login: "user-a",
            type: "User",
          },
        },
      ],
    });

    mockListReposAccessibleToInstallation.mockResolvedValueOnce({
      data: {
        total_count: 2,
        repositories: [
          {
            id: 1001,
            name: "repo-alpha",
            full_name: "user-a/repo-alpha",
            owner: { login: "user-a" },
          },
          {
            id: 1002,
            name: "repo-beta",
            full_name: "user-a/repo-beta",
            owner: { login: "user-a" },
          },
        ],
      },
    });

    const { POST } = await import("./route");
    await POST(new Request("http://localhost:3000/api/installations/sync", { method: "POST" }));
    expect(mockDb.repos.length).toBe(2);

    // 2. Second sync where repo 1002 was removed / uninstalled on GitHub
    mockListReposAccessibleToInstallation.mockResolvedValueOnce({
      data: {
        total_count: 1,
        repositories: [
          {
            id: 1001,
            name: "repo-alpha",
            full_name: "user-a/repo-alpha",
            owner: { login: "user-a" },
          },
        ],
      },
    });

    const res = await POST(new Request("http://localhost:3000/api/installations/sync", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ installations: 1, repos: 1 });

    expect(mockDb.repos.length).toBe(1);
    expect(mockDb.repos[0].github_repo_id).toBe(1001);
  });

  it("prevents a user from claiming another user's installation", async () => {
    // GitHub returns an installation belonging to User B (github_user_id 2222)
    mockListInstallations.mockResolvedValueOnce({
      data: [
        {
          id: 701,
          target_type: "User",
          account: {
            id: 2222,
            login: "user-b",
            type: "User",
          },
        },
      ],
    });

    // Current user is User A (github_user_id 1111)
    currentUser = { id: userAProfile.id };

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost:3000/api/installations/sync", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    // User A should get 0 installations and 0 repos
    expect(body).toEqual({ installations: 0, repos: 0 });
    expect(mockDb.installations.length).toBe(0);
    expect(mockDb.repos.length).toBe(0);
  });

  it("strictly matches account.id and rejects login-only match when id differs", async () => {
    // GitHub returns an installation whose login matches userA, but id belongs to another account
    mockListInstallations.mockResolvedValueOnce({
      data: [
        {
          id: 801,
          target_type: "User",
          account: {
            id: 9999, // different id
            login: userAProfile.github_username, // same login
            type: "User",
          },
        },
      ],
    });

    currentUser = { id: userAProfile.id };

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost:3000/api/installations/sync", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual({ installations: 0, repos: 0 });
    expect(mockDb.installations.length).toBe(0);
  });

  it("skips installation and never reassigns owner if existingDbInst belongs to a different owner", async () => {
    // Existing DB installation owned by User B
    mockDb.installations.push({
      id: "inst-b-uuid",
      installation_id: 901,
      owner_id: userBProfile.id,
      account_login: "user-b",
      account_type: "User",
    });
    // Existing repo belonging to User B's installation
    mockDb.repos.push({
      id: "repo-b-uuid",
      installation_id: "inst-b-uuid",
      github_repo_id: 5555,
      owner: "user-b",
      name: "repo-b",
      full_name: "user-b/repo-b",
      is_active: true,
      updated_at: new Date().toISOString(),
    });

    // GitHub returns installation 901 with user A's account id
    mockListInstallations.mockResolvedValueOnce({
      data: [
        {
          id: 901,
          target_type: "User",
          account: {
            id: userAProfile.github_user_id,
            login: userAProfile.github_username,
            type: "User",
          },
        },
      ],
    });

    currentUser = { id: userAProfile.id };

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost:3000/api/installations/sync", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Takeover refused: 0 installations synced, existing installation still owned by user B
    expect(body.installations).toBe(0);
    const dbInst = mockDb.installations.find((i) => i.installation_id === 901);
    expect(dbInst?.owner_id).toBe(userBProfile.id);
    // Repos under user B's installation must not be deleted
    expect(mockDb.repos.some((r) => r.github_repo_id === 5555)).toBe(true);
  });
});

describe("Live Supabase Integration - Sync Idempotency", () => {
  function getLiveConfig() {
    const envPath = path.resolve(process.cwd(), ".env.local");
    const fileEnv: Record<string, string> = {};

    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          fileEnv[key] = val;
        }
      }
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

    return { supabaseUrl, serviceKey };
  }

  const { supabaseUrl, serviceKey } = getLiveConfig();
  const canRunLive = Boolean(supabaseUrl && serviceKey);

  it.skipIf(!canRunLive)(
    "creates installation, repo, and default repo_settings idempotently on live database",
    async () => {
      const client = createClient(supabaseUrl!, serviceKey!, {
        auth: { persistSession: false },
      });

      // 1. Fetch real user profile row
      const { data: profiles } = await client
        .from("profiles")
        .select("id")
        .limit(1);
      expect(profiles && profiles.length > 0).toBe(true);
      const profileId = profiles![0].id;

      // Exact IDs
      const testInstId = "00000000-0000-0000-0000-000000000201";
      const testInstallationId = 9999201;
      const testRepoId = "00000000-0000-0000-0000-000000000202";
      const testGitHubRepoId = 9999202;

      try {
        // Run 1: Upsert installation
        const { data: instData1 } = await client
          .from("installations")
          .upsert(
            {
              id: testInstId,
              installation_id: testInstallationId,
              owner_id: profileId,
              account_login: "test-live-user",
              account_type: "User",
            },
            { onConflict: "installation_id" }
          )
          .select("id, installation_id")
          .single();
        expect(instData1?.id).toBe(testInstId);

        // Run 1: Upsert repo
        const { data: repoData1 } = await client
          .from("repos")
          .upsert(
            {
              id: testRepoId,
              installation_id: testInstId,
              github_repo_id: testGitHubRepoId,
              owner: "test-live-user",
              name: "live-test-repo",
              full_name: "test-live-user/live-test-repo",
              is_active: true,
            },
            { onConflict: "github_repo_id" }
          )
          .select("id, github_repo_id")
          .single();
        expect(repoData1?.id).toBe(testRepoId);

        // Run 1: Create default repo_settings
        const { error: settingsErr1 } = await client
          .from("repo_settings")
          .upsert(
            {
              repo_id: testRepoId,
              ignored_paths: [],
              strictness: "balanced",
              custom_instructions: "",
            },
            { onConflict: "repo_id", ignoreDuplicates: true }
          );
        expect(settingsErr1).toBeNull();

        // Verify initial rows exist
        const { data: s1 } = await client
          .from("repo_settings")
          .select("*")
          .eq("repo_id", testRepoId)
          .single();
        expect(s1).toBeTruthy();
        expect(s1.strictness).toBe("balanced");

        // Mutate custom instructions to verify idempotency preserves existing settings
        await client
          .from("repo_settings")
          .update({ custom_instructions: "Custom live rules" })
          .eq("repo_id", testRepoId);

        // Run 2: Upsert installation, repo, and default repo_settings again (Idempotency)
        await client
          .from("installations")
          .upsert(
            {
              id: testInstId,
              installation_id: testInstallationId,
              owner_id: profileId,
              account_login: "test-live-user",
              account_type: "User",
            },
            { onConflict: "installation_id" }
          );

        await client
          .from("repos")
          .upsert(
            {
              id: testRepoId,
              installation_id: testInstId,
              github_repo_id: testGitHubRepoId,
              owner: "test-live-user",
              name: "live-test-repo",
              full_name: "test-live-user/live-test-repo",
              is_active: true,
            },
            { onConflict: "github_repo_id" }
          );

        await client
          .from("repo_settings")
          .upsert(
            {
              repo_id: testRepoId,
              ignored_paths: [],
              strictness: "balanced",
              custom_instructions: "",
            },
            { onConflict: "repo_id", ignoreDuplicates: true }
          );

        // Verify preserved custom instructions and no duplicates
        const { data: s2 } = await client
          .from("repo_settings")
          .select("*")
          .eq("repo_id", testRepoId)
          .single();
        expect(s2.custom_instructions).toBe("Custom live rules");
      } finally {
        // Delete ONLY the exact IDs created
        await client.from("repo_settings").delete().eq("repo_id", testRepoId);
        await client.from("repos").delete().eq("id", testRepoId);
        await client.from("installations").delete().eq("id", testInstId);

        // Verify user profile still exists
        const { data: profileCheck } = await client
          .from("profiles")
          .select("id")
          .eq("id", profileId)
          .single();
        expect(profileCheck).toBeTruthy();
      }
    },
    30000
  );
});
