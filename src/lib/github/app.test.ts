import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { getInstallationOctokit, getAppOctokit, loadPrivateKey } from "./app";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

vi.mock("@octokit/rest", () => {
  const MockOctokit = vi.fn().mockImplementation(function (this: unknown, options: unknown) {
    return {
      options,
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
