import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

/**
 * Returns an authenticated Octokit instance for the GitHub App itself (App-level authentication).
 * Uses @octokit/auth-app to mint JWT tokens for app-level endpoints (e.g. apps.listInstallations).
 */
export function getAppOctokit(): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY;

  if (!appId) {
    throw new Error("GITHUB_APP_ID environment variable is not configured");
  }

  if (!privateKeyRaw) {
    throw new Error("GITHUB_APP_PRIVATE_KEY environment variable is not configured");
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });
}

/**
 * Returns an authenticated Octokit instance for a specific GitHub App installation.
 * Uses @octokit/auth-app to mint and refresh installation tokens automatically.
 */
export function getInstallationOctokit(installationId: number): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY;

  if (!appId) {
    throw new Error("GITHUB_APP_ID environment variable is not configured");
  }

  if (!privateKeyRaw) {
    throw new Error("GITHUB_APP_PRIVATE_KEY environment variable is not configured");
  }

  // Handle literal escaped newlines that frequently occur in environment variables
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });
}
