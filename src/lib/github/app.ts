import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { createPrivateKey } from "node:crypto";

function stripWrappingQuotes(str: string): string {
  let s = str.trim();
  while (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Loads, normalises, and validates the GitHub App RSA private key.
 * Checks, in priority order:
 * 1. process.env.GITHUB_PRIVATE_KEY_BASE64
 * 2. process.env.GITHUB_PRIVATE_KEY
 * 3. process.env.GITHUB_APP_PRIVATE_KEY
 * (or uses rawKeyInput if explicitly provided).
 *
 * Normalises single-line PEMs, literal \n, space-collapsed PEMs, base64 encodings,
 * and wrapping quotes. Validates that the key is an RSA private key using node:crypto,
 * and exports it as canonical PKCS#8 PEM.
 *
 * Throws generic GITHUB_KEY_MISSING or GITHUB_KEY_INVALID without leaking secret bytes.
 */
export function loadPrivateKey(rawKeyInput?: string): string {
  let raw: string | undefined;

  if (rawKeyInput !== undefined) {
    raw = rawKeyInput;
  } else if (process.env.GITHUB_PRIVATE_KEY_BASE64 && process.env.GITHUB_PRIVATE_KEY_BASE64.trim()) {
    raw = process.env.GITHUB_PRIVATE_KEY_BASE64;
  } else if (process.env.GITHUB_PRIVATE_KEY && process.env.GITHUB_PRIVATE_KEY.trim()) {
    raw = process.env.GITHUB_PRIVATE_KEY;
  } else if (process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_PRIVATE_KEY.trim()) {
    raw = process.env.GITHUB_APP_PRIVATE_KEY;
  }

  if (!raw || !raw.trim()) {
    throw new Error("GITHUB_KEY_MISSING");
  }

  // 1. Strip wrapping quotes and whitespace
  let cleaned = stripWrappingQuotes(raw.trim());

  // 2. Decode from base64 if the input lacks "-----BEGIN" (e.g. from base64 env var or unformatted base64)
  if (!cleaned.includes("-----BEGIN")) {
    try {
      const strippedBase64 = cleaned.replace(/\s+/g, "");
      const decoded = Buffer.from(strippedBase64, "base64").toString("utf8");
      cleaned = stripWrappingQuotes(decoded.trim());
    } catch {
      throw new Error("GITHUB_KEY_INVALID");
    }
  }

  // 3. Normalise literal \n, \r\n, and carriage returns
  let pem = cleaned
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  // 4. If PEM header and footer are present, re-chunk the base64 payload into 64-character lines
  const headerMatch = pem.match(/-----BEGIN [A-Z0-9 ]+-----/);
  const footerMatch = pem.match(/-----END [A-Z0-9 ]+-----/);
  if (headerMatch && footerMatch) {
    const header = headerMatch[0];
    const footer = footerMatch[0];
    const headerEndIndex = pem.indexOf(header) + header.length;
    const footerStartIndex = pem.indexOf(footer);
    if (headerEndIndex < footerStartIndex) {
      const body = pem.substring(headerEndIndex, footerStartIndex);
      const cleanedBody = body.replace(/\s+/g, "");
      const chunkedBody = cleanedBody.match(/.{1,64}/g)?.join("\n") || "";
      pem = `${header}\n${chunkedBody}\n${footer}\n`;
    }
  }

  // 5. Parse and validate with node:crypto
  try {
    const keyObject = createPrivateKey(pem);
    if (keyObject.asymmetricKeyType !== "rsa") {
      throw new Error("GITHUB_KEY_INVALID");
    }
    const pkcs8Pem = keyObject.export({ type: "pkcs8", format: "pem" });
    return typeof pkcs8Pem === "string" ? pkcs8Pem : pkcs8Pem.toString("utf8");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message === "GITHUB_KEY_MISSING" || err.message === "GITHUB_KEY_INVALID")
    ) {
      throw err;
    }
    throw new Error("GITHUB_KEY_INVALID");
  }
}

/**
 * Returns an authenticated Octokit instance for the GitHub App itself (App-level authentication).
 * Uses @octokit/auth-app to mint JWT tokens for app-level endpoints (e.g. apps.listInstallations).
 */
export function getAppOctokit(): Octokit {
  const appId = process.env.GITHUB_APP_ID;

  if (!appId) {
    throw new Error("GITHUB_APP_ID_MISSING");
  }

  const privateKey = loadPrivateKey();

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });

  return attachDiagnosticsHooks(octokit);
}

/**
 * Returns an authenticated Octokit instance for a specific GitHub App installation.
 * Uses @octokit/auth-app to mint and refresh installation tokens automatically.
 */
export function getInstallationOctokit(installationId: number): Octokit {
  const appId = process.env.GITHUB_APP_ID;

  if (!appId) {
    throw new Error("GITHUB_APP_ID_MISSING");
  }

  const privateKey = loadPrivateKey();

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });

  return attachDiagnosticsHooks(octokit);
}

/**
 * Safely extracts header values (case-insensitively) without leaking objects or headers.
 */
export function getHeaderValue(
  headers: Record<string, unknown> | Headers | undefined,
  name: string
): string {
  if (!headers) return "none";
  const lowerName = name.toLowerCase();
  if (typeof (headers as Headers).get === "function") {
    const val = (headers as Headers).get(lowerName);
    return val && val.trim() ? val.trim() : "none";
  }
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      if (val !== undefined && val !== null) {
        if (Array.isArray(val) && val.length > 0) {
          const first = String(val[0]).trim();
          return first || "none";
        }
        const str = String(val).trim();
        return str || "none";
      }
    }
  }
  return "none";
}

/**
 * Derives a human-readable API operation label from request options.
 */
export function getOperationLabel(options?: {
  method?: string;
  url?: string;
  mediaType?: { format?: string };
}): string {
  if (!options) return "request";
  const url = options.url || "";
  const method = (options.method || "GET").toUpperCase();

  if (url.includes("/pulls") && options.mediaType?.format === "diff") {
    return "pulls.get diff";
  }
  if (url.includes("/pulls") && url.includes("/reviews") && method === "POST") {
    return "pulls.createReview";
  }
  if (url.includes("/pulls") && url.includes("/reviews") && method === "PUT") {
    return "pulls.updateReview";
  }
  if (url.includes("/pulls") && url.includes("/reviews") && method === "GET") {
    return "pulls.listReviews";
  }
  if (url.includes("/pulls") && url.includes("/comments") && method === "POST") {
    return "pulls.createReviewComment";
  }
  if (url.includes("/pulls") && method === "GET") {
    return "pulls.get";
  }
  if (url.includes("/access_tokens") && method === "POST") {
    return "app.createInstallationAccessToken";
  }
  if (url.includes("/issues") && url.includes("/comments") && method === "POST") {
    return "issues.createComment";
  }

  // Strip query parameters to prevent leaking any URL parameters in diagnostics
  const cleanUrl = url.split("?")[0];
  return `${method} ${cleanUrl}`;
}

/**
 * Checks whether an error is a GitHub HTTP 401 Unauthorized or HTTP 403 Forbidden.
 */
export function isGitHubAuthOrPermissionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status =
    (err as { status?: number; response?: { status?: number } }).status ||
    (err as { response?: { status?: number } }).response?.status;
  return status === 401 || status === 403;
}

/**
 * Formats a GitHub 401/403 error into a sanitized diagnostic string containing only:
 * - HTTP status
 * - operation label
 * - x-accepted-github-permissions header (or "none")
 * - x-github-request-id header (or "none")
 * Completely redacts everything else to guarantee zero credential/header leakage.
 */
export function formatGitHubError(err: unknown, operationLabel: string): string {
  if (err instanceof Error && /^GitHub (401|403) at /.test(err.message)) {
    return err.message;
  }
  const obj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const status =
    (obj.status as number | undefined) ||
    ((obj.response as { status?: number } | undefined)?.status) ||
    403;
  const headers = (obj.response as { headers?: Record<string, unknown> | Headers } | undefined)
    ?.headers;
  const accepted = getHeaderValue(headers, "x-accepted-github-permissions");
  const requestId = getHeaderValue(headers, "x-github-request-id");

  return `GitHub ${status} at ${operationLabel}: accepted=[${accepted}], request_id=${requestId}`;
}

/**
 * Attaches safe diagnostics hooks to an Octokit instance:
 * 1. On access token mint/refresh: logs ONLY the permissions object returned by GitHub
 *    (permission names and access levels only, never any token or auth header).
 * 2. On 401/403 errors: intercepts and formats into a sanitized diagnostic string.
 */
export function attachDiagnosticsHooks<T extends Octokit>(octokit: T): T {
  if (!octokit || !octokit.hook) {
    return octokit;
  }

  octokit.hook.wrap("request", async (request, options) => {
    const response = await request(options);

    if (
      options?.url &&
      typeof options.url === "string" &&
      options.url.includes("/access_tokens") &&
      response?.data &&
      typeof response.data === "object" &&
      "permissions" in response.data
    ) {
      const rawPerms = (response.data as { permissions?: Record<string, string> }).permissions;
      if (rawPerms && typeof rawPerms === "object") {
        const sanitizedPerms: Record<string, string> = {};
        for (const [key, val] of Object.entries(rawPerms)) {
          if (typeof val === "string") {
            sanitizedPerms[key] = val;
          }
        }
        console.info(
          "[GITHUB_AUTH] Installation token permissions:",
          JSON.stringify(sanitizedPerms)
        );
      }
    }

    return response;
  });

  octokit.hook.error("request", async (error, options) => {
    if (isGitHubAuthOrPermissionError(error)) {
      const label = getOperationLabel(options);
      const sanitizedMessage = formatGitHubError(error, label);
      error.message = sanitizedMessage;

      // Defense-in-depth: scrub authorization header from underlying RequestError request metadata
      if (error && typeof error === "object" && "request" in error) {
        const req = (error as { request?: { headers?: Record<string, unknown> } }).request;
        if (req?.headers) {
          delete req.headers.authorization;
          delete req.headers.Authorization;
        }
      }
    }
    throw error;
  });

  return octokit;
}
