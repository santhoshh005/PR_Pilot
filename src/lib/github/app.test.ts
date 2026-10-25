import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  getInstallationOctokit,
  getAppOctokit,
  loadPrivateKey,
  formatGitHubError,
  getHeaderValue,
  getOperationLabel,
  isGitHubAuthOrPermissionError,
  attachDiagnosticsHooks,
} from "./app";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

vi.mock("@octokit/rest", () => {
  const MockOctokit = vi.fn().mockImplementation(function (this: unknown, options: unknown) {
    return {
      options,
      hook: {
        wrap: vi.fn(),
        error: vi.fn(),
      },
      rest: {
        pulls: {
          get: vi.fn(),
        },
      },
    };
  });
  return {
    Octokit: MockOctokit,
  };
});

vi.mock("@octokit/auth-app", () => {
  return {
    createAppAuth: vi.fn().mockReturnValue("mocked-auth-strategy"),
  };
});

// Generate throwaway RSA key pair at runtime for testing (never committed or hardcoded)
const { privateKey: throwawayPkcs1Pem } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const { privateKey: throwawayPkcs8Pem } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("loadPrivateKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GITHUB_PRIVATE_KEY_BASE64;
    delete process.env.GITHUB_PRIVATE_KEY;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws GITHUB_KEY_MISSING when no private key environment variable is set", () => {
    expect(() => loadPrivateKey()).toThrowError("GITHUB_KEY_MISSING");
  });

  it("throws GITHUB_KEY_MISSING when private key is empty or whitespace", () => {
    process.env.GITHUB_PRIVATE_KEY = "   ";
    expect(() => loadPrivateKey()).toThrowError("GITHUB_KEY_MISSING");
  });

  it("loads and normalises a PKCS#1 multiline PEM key into PKCS#8 format", () => {
    process.env.GITHUB_PRIVATE_KEY = throwawayPkcs1Pem;
    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(key).toContain("-----END PRIVATE KEY-----");
  });

  it("loads and preserves a PKCS#8 multiline PEM key", () => {
    process.env.GITHUB_PRIVATE_KEY = throwawayPkcs8Pem;
    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(key).toContain("-----END PRIVATE KEY-----");
  });

  it("handles single-line PEM with literal escaped \\n sequences", () => {
    const singleLineLiteral = throwawayPkcs1Pem.replace(/\r?\n/g, "\\n");
    process.env.GITHUB_PRIVATE_KEY = singleLineLiteral;
    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(key).toContain("-----END PRIVATE KEY-----");
  });

  it("handles single-line PEM where newlines were substituted with spaces", () => {
    const spaceSubstituted = throwawayPkcs1Pem.replace(/\r?\n/g, " ");
    process.env.GITHUB_PRIVATE_KEY = spaceSubstituted;
    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(key).toContain("-----END PRIVATE KEY-----");
  });

  it("loads from GITHUB_PRIVATE_KEY_BASE64 (raw base64 of PEM)", () => {
    const base64Key = Buffer.from(throwawayPkcs1Pem).toString("base64");
    process.env.GITHUB_PRIVATE_KEY_BASE64 = base64Key;
    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(key).toContain("-----END PRIVATE KEY-----");
  });

  it("handles GITHUB_PRIVATE_KEY_BASE64 wrapped in quotes with internal whitespace and newlines", () => {
    const base64Key = Buffer.from(throwawayPkcs1Pem).toString("base64");
    // Add newlines, spaces, and wrap in double quotes
    const formattedBase64 = `"\n  ${base64Key.slice(0, 50)}\n  ${base64Key.slice(50)}  \n"`;
    process.env.GITHUB_PRIVATE_KEY_BASE64 = formattedBase64;
    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(key).toContain("-----END PRIVATE KEY-----");
  });

  it("handles base64 passed into GITHUB_PRIVATE_KEY lacking -----BEGIN header", () => {
    const base64Key = Buffer.from(throwawayPkcs1Pem).toString("base64");
    process.env.GITHUB_PRIVATE_KEY = `'${base64Key}'`;
    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
    expect(key).toContain("-----END PRIVATE KEY-----");
  });

  it("respects priority order: BASE64 > GITHUB_PRIVATE_KEY > GITHUB_APP_PRIVATE_KEY", () => {
    const base64Key = Buffer.from(throwawayPkcs8Pem).toString("base64");
    process.env.GITHUB_PRIVATE_KEY_BASE64 = base64Key;
    process.env.GITHUB_PRIVATE_KEY = "corrupted-key-1";
    process.env.GITHUB_APP_PRIVATE_KEY = "corrupted-key-2";

    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("respects secondary priority order: GITHUB_PRIVATE_KEY > GITHUB_APP_PRIVATE_KEY", () => {
    process.env.GITHUB_PRIVATE_KEY = throwawayPkcs8Pem;
    process.env.GITHUB_APP_PRIVATE_KEY = "corrupted-key-2";

    const key = loadPrivateKey();
    expect(key).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("strips wrapping double and single quotes from PEM input", () => {
    process.env.GITHUB_PRIVATE_KEY = `"${throwawayPkcs8Pem}"`;
    const keyDouble = loadPrivateKey();
    expect(keyDouble).toContain("-----BEGIN PRIVATE KEY-----");

    process.env.GITHUB_PRIVATE_KEY = `'${throwawayPkcs8Pem}'`;
    const keySingle = loadPrivateKey();
    expect(keySingle).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("throws GITHUB_KEY_INVALID for unparseable or garbage key and never leaks key bytes", () => {
    const canaryToken = "CANARY_SECRET_BYTES_DO_NOT_LEAK";
    process.env.GITHUB_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----\n${canaryToken}\n-----END RSA PRIVATE KEY-----`;

    try {
      loadPrivateKey();
      expect.fail("Should have thrown GITHUB_KEY_INVALID");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toBe("GITHUB_KEY_INVALID");
      expect(msg).not.toContain(canaryToken);
    }
  });

  it("throws GITHUB_KEY_INVALID for non-RSA keys (e.g. EC key)", () => {
    const { privateKey: ecKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.GITHUB_PRIVATE_KEY = ecKey;

    expect(() => loadPrivateKey()).toThrowError("GITHUB_KEY_INVALID");
  });

  it("produces a key that can mint an app JWT via actual createAppAuth", async () => {
    // Import actual createAppAuth to verify JWT signing without mocks
    const actualAuthApp = await vi.importActual<typeof import("@octokit/auth-app")>(
      "@octokit/auth-app"
    );
    process.env.GITHUB_PRIVATE_KEY = throwawayPkcs1Pem;
    const pkcs8Key = loadPrivateKey();

    const auth = actualAuthApp.createAppAuth({
      appId: 12345,
      privateKey: pkcs8Key,
    });

    const appAuthResult = await auth({ type: "app" });
    expect(appAuthResult.type).toBe("app");
    expect(appAuthResult.token).toMatch(/^eyJ/);
  });
});

describe("getInstallationOctokit", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws if GITHUB_APP_ID is not configured", () => {
    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = throwawayPkcs8Pem;

    expect(() => getInstallationOctokit(12345)).toThrowError(
      "GITHUB_APP_ID_MISSING"
    );
  });

  it("throws GITHUB_KEY_MISSING if private key is not configured", () => {
    process.env.GITHUB_APP_ID = "999";
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_PRIVATE_KEY;
    delete process.env.GITHUB_PRIVATE_KEY_BASE64;

    expect(() => getInstallationOctokit(12345)).toThrowError(
      "GITHUB_KEY_MISSING"
    );
  });

  it("creates an Octokit instance with createAppAuth and formatted private key", () => {
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_PRIVATE_KEY = throwawayPkcs8Pem;

    const octokit = getInstallationOctokit(789);

    expect(octokit).toBeDefined();
    expect(Octokit).toHaveBeenCalledTimes(1);
    expect(Octokit).toHaveBeenCalledWith({
      authStrategy: createAppAuth,
      auth: {
        appId: "123456",
        privateKey: expect.stringContaining("-----BEGIN PRIVATE KEY-----"),
        installationId: 789,
      },
    });
  });

  it("does not leak secret values in error messages", () => {
    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = throwawayPkcs8Pem;

    try {
      getInstallationOctokit(123);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(throwawayPkcs8Pem);
    }
  });
});

describe("getAppOctokit", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws if GITHUB_APP_ID is missing", () => {
    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = throwawayPkcs8Pem;
    expect(() => getAppOctokit()).toThrowError("GITHUB_APP_ID_MISSING");
  });

  it("throws GITHUB_KEY_MISSING if private key is missing", () => {
    process.env.GITHUB_APP_ID = "123";
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_PRIVATE_KEY;
    delete process.env.GITHUB_PRIVATE_KEY_BASE64;
    expect(() => getAppOctokit()).toThrowError("GITHUB_KEY_MISSING");
  });

  it("creates app-level Octokit without installationId", () => {
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_PRIVATE_KEY = throwawayPkcs8Pem;

    const octokit = getAppOctokit();
    expect(octokit).toBeDefined();
    expect(Octokit).toHaveBeenCalledWith({
      authStrategy: createAppAuth,
      auth: {
        appId: "123456",
        privateKey: expect.stringContaining("-----BEGIN PRIVATE KEY-----"),
      },
    });
  });
});

describe("Diagnostics Hooks and Error Sanitization", () => {
  describe("getHeaderValue", () => {
    it("retrieves header value case-insensitively from a plain object", () => {
      const headers = { "X-Accepted-GitHub-Permissions": "pull_requests=read" };
      expect(getHeaderValue(headers, "x-accepted-github-permissions")).toBe("pull_requests=read");
      expect(getHeaderValue(headers, "other-header")).toBe("none");
      expect(getHeaderValue(undefined, "x-accepted-github-permissions")).toBe("none");
    });

    it("retrieves header value from a Headers instance", () => {
      const headers = new Headers();
      headers.set("x-github-request-id", "REQ-ABC-123");
      expect(getHeaderValue(headers, "X-GitHub-Request-Id")).toBe("REQ-ABC-123");
      expect(getHeaderValue(headers, "absent-header")).toBe("none");
    });
  });

  describe("getOperationLabel", () => {
    it("maps pull diff request to 'pulls.get diff'", () => {
      expect(
        getOperationLabel({
          method: "GET",
          url: "/repos/{owner}/{repo}/pulls/{pull_number}",
          mediaType: { format: "diff" },
        })
      ).toBe("pulls.get diff");
    });

    it("maps review creation to 'pulls.createReview'", () => {
      expect(
        getOperationLabel({
          method: "POST",
          url: "/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        })
      ).toBe("pulls.createReview");
    });

    it("maps review update to 'pulls.updateReview'", () => {
      expect(
        getOperationLabel({
          method: "PUT",
          url: "/repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
        })
      ).toBe("pulls.updateReview");
    });

    it("maps token minting to 'app.createInstallationAccessToken'", () => {
      expect(
        getOperationLabel({
          method: "POST",
          url: "/app/installations/{installation_id}/access_tokens",
        })
      ).toBe("app.createInstallationAccessToken");
    });
  });

  describe("formatGitHubError", () => {
    it("formats 403 error into sanitized diagnostic string with accepted permissions and request_id", () => {
      const error = Object.assign(new Error("Resource not accessible by integration"), {
        status: 403,
        response: {
          status: 403,
          headers: {
            "x-accepted-github-permissions": "pull_requests=read",
            "x-github-request-id": "1A2B:3C4D:5E6F",
          },
        },
      });

      const formatted = formatGitHubError(error, "pulls.get diff");
      expect(formatted).toBe(
        "GitHub 403 at pulls.get diff: accepted=[pull_requests=read], request_id=1A2B:3C4D:5E6F"
      );
    });

    it("uses 'none' when headers are absent and contains no secret tokens or keys", () => {
      const canarySecret = "ghs_SECRET_TOKEN_DO_NOT_LEAK";
      const error = Object.assign(new Error(`Failed with ${canarySecret}`), {
        status: 401,
        response: {
          status: 401,
        },
      });

      const formatted = formatGitHubError(error, "pulls.createReview");
      expect(formatted).toBe("GitHub 401 at pulls.createReview: accepted=[none], request_id=none");
      expect(formatted).not.toContain(canarySecret);
    });

    it("does not double-format an already formatted error string", () => {
      const preformatted = new Error(
        "GitHub 403 at pulls.get diff: accepted=[pull_requests=read], request_id=REQ-1"
      );
      expect(formatGitHubError(preformatted, "pulls.get diff")).toBe(
        "GitHub 403 at pulls.get diff: accepted=[pull_requests=read], request_id=REQ-1"
      );
    });
  });

  describe("isGitHubAuthOrPermissionError", () => {
    it("returns true for 401 and 403 status codes", () => {
      expect(isGitHubAuthOrPermissionError({ status: 401 })).toBe(true);
      expect(isGitHubAuthOrPermissionError({ status: 403 })).toBe(true);
      expect(isGitHubAuthOrPermissionError({ response: { status: 403 } })).toBe(true);
      expect(isGitHubAuthOrPermissionError({ status: 404 })).toBe(false);
      expect(isGitHubAuthOrPermissionError({ status: 500 })).toBe(false);
      expect(isGitHubAuthOrPermissionError(null)).toBe(false);
    });
  });

  describe("attachDiagnosticsHooks", () => {
    type RequestFn = (opt: unknown) => Promise<{ data: unknown; headers?: Record<string, string> }>;
    type WrapHandler = (req: RequestFn, opt: { url?: string; method?: string }) => Promise<{ data: unknown }>;
    type ErrorHandler = (err: unknown, opt: { url?: string; method?: string }) => Promise<never>;

    it("logs permissions object on token mint and NEVER logs the token or headers", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      let wrappedHandler: WrapHandler | null = null;
      const fakeOctokit = {
        hook: {
          wrap: vi.fn().mockImplementation((name: string, fn: WrapHandler) => {
            if (name === "request") wrappedHandler = fn;
          }),
          error: vi.fn(),
        },
      } as unknown as Octokit;

      attachDiagnosticsHooks(fakeOctokit);
      expect(fakeOctokit.hook.wrap).toHaveBeenCalledWith("request", expect.any(Function));

      const fakeToken = "ghs_SENSITIVE_BEARER_TOKEN_999";
      const fakePermissions = { pull_requests: "write", metadata: "read" };

      const mockRequest = vi.fn().mockResolvedValue({
        data: {
          token: fakeToken,
          expires_at: "2026-10-25T14:00:00Z",
          permissions: fakePermissions,
        },
        headers: {
          authorization: `bearer ${fakeToken}`,
        },
      });

      const options = {
        url: "/app/installations/123/access_tokens",
        method: "POST",
      };

      const res = await wrappedHandler!(mockRequest, options);
      expect((res.data as { token: string }).token).toBe(fakeToken);

      expect(infoSpy).toHaveBeenCalled();
      const loggedArgs = infoSpy.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(loggedArgs).toContain("pull_requests");
      expect(loggedArgs).toContain("write");
      // STRICT: Must never log token, bearer, or auth headers
      expect(loggedArgs).not.toContain(fakeToken);
      expect(loggedArgs).not.toContain("bearer");

      infoSpy.mockRestore();
    });

    it("error hook intercepts 403 and formats sanitized diagnostic error without token fragments", async () => {
      let errorHandler: ErrorHandler | null = null;
      const fakeOctokit = {
        hook: {
          wrap: vi.fn(),
          error: vi.fn().mockImplementation((name: string, fn: ErrorHandler) => {
            if (name === "request") errorHandler = fn;
          }),
        },
      } as unknown as Octokit;

      attachDiagnosticsHooks(fakeOctokit);
      expect(fakeOctokit.hook.error).toHaveBeenCalledWith("request", expect.any(Function));

      const canarySecret = "ghs_SECRET_INTEGRATION_TOKEN_ABC";
      const mockError = Object.assign(new Error(`Forbidden ${canarySecret}`), {
        status: 403,
        response: {
          status: 403,
          headers: {
            "x-accepted-github-permissions": "pull_requests=write",
            "x-github-request-id": "REQ-DIAG-403",
          },
        },
      });

      const options = {
        url: "/repos/owner/repo/pulls/1/reviews",
        method: "POST",
      };

      await expect(errorHandler!(mockError, options)).rejects.toThrowError(
        "GitHub 403 at pulls.createReview: accepted=[pull_requests=write], request_id=REQ-DIAG-403"
      );
      expect(mockError.message).not.toContain(canarySecret);
    });
  });
});
