import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getInstallationOctokit, getAppOctokit } from "./app";
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
    process.env.GITHUB_APP_PRIVATE_KEY = "dummy-key";

    expect(() => getInstallationOctokit(12345)).toThrowError(
      /GITHUB_APP_ID/
    );
  });

  it("throws if GITHUB_APP_PRIVATE_KEY is not configured", () => {
    process.env.GITHUB_APP_ID = "999";
    delete process.env.GITHUB_APP_PRIVATE_KEY;

    expect(() => getInstallationOctokit(12345)).toThrowError(
      /GITHUB_APP_PRIVATE_KEY/
    );
  });

  it("creates an Octokit instance with createAppAuth and formatted private key", () => {
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\\nMIIE...\\n-----END RSA PRIVATE KEY-----";

    const octokit = getInstallationOctokit(789);

    expect(octokit).toBeDefined();
    expect(Octokit).toHaveBeenCalledTimes(1);
    expect(Octokit).toHaveBeenCalledWith({
      authStrategy: createAppAuth,
      auth: {
        appId: "123456",
        privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
        installationId: 789,
      },
    });
  });

  it("does not leak secret values in error messages", () => {
    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = "SUPER_SECRET_VALUE";

    try {
      getInstallationOctokit(123);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain("SUPER_SECRET_VALUE");
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
    process.env.GITHUB_APP_PRIVATE_KEY = "dummy";
    expect(() => getAppOctokit()).toThrowError(/GITHUB_APP_ID/);
  });

  it("throws if private key is missing", () => {
    process.env.GITHUB_APP_ID = "123";
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_PRIVATE_KEY;
    expect(() => getAppOctokit()).toThrowError(/GITHUB_APP_PRIVATE_KEY/);
  });

  it("creates app-level Octokit without installationId", () => {
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\\nKEY\\n-----END RSA PRIVATE KEY-----";

    const octokit = getAppOctokit();
    expect(octokit).toBeDefined();
    expect(Octokit).toHaveBeenCalledWith({
      authStrategy: createAppAuth,
      auth: {
        appId: "123456",
        privateKey: "-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----",
      },
    });
  });
});
