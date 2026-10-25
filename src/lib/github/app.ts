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

  if (!appId) {
    throw new Error("GITHUB_APP_ID_MISSING");
  }

  const privateKey = loadPrivateKey();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });
}
