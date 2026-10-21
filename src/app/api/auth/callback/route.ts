import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkAuthRateLimit, rateLimitResponse } from "@/lib/rate-limit";

function getAppOrigin(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // ignore invalid URL
    }
  }
  return "http://localhost:3000";
}

export function sanitizeNextUrl(rawNext: string | null | undefined): string {
  const defaultPath = "/dashboard";
  if (!rawNext || typeof rawNext !== "string") {
    return defaultPath;
  }
  const trimmed = rawNext.trim();
  // Must start with exactly one '/', not '//' or '/\'
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return defaultPath;
  }
  // Must not contain backslashes
  if (trimmed.includes("\\")) {
    return defaultPath;
  }
  // Must not contain control characters
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return defaultPath;
  }
  try {
    const dummyBase = "http://localhost";
    const parsed = new URL(trimmed, dummyBase);
    // Ensure origin is not altered and pathname is relative
    if (parsed.origin !== dummyBase || !parsed.pathname.startsWith("/")) {
      return defaultPath;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return defaultPath;
  }
}

export async function GET(request: Request) {
  const appOrigin = getAppOrigin();

  const rateLimit = await checkAuthRateLimit(request);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfter);
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const rawNext = requestUrl.searchParams.get("next");
  const next = sanitizeNextUrl(rawNext);

  if (!code) {
    return NextResponse.redirect(new URL("/error?error=missing_code", appOrigin));
  }

  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error("Auth exchange error:", error?.message);
    return NextResponse.redirect(
      new URL("/error?error=auth_exchange_failed", appOrigin)
    );
  }

  const user = data.user;
  const session = data.session;

  let githubUserId: number | null = null;
  let githubUsername = "";
  let avatarUrl: string | null = null;

  // 1. Fetch user data directly from GitHub if provider_token is available
  if (session?.provider_token) {
    try {
      const ghResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${session.provider_token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "PRPilot-Auth",
        },
      });

      if (ghResponse.ok) {
        const ghUser = await ghResponse.json();
        githubUserId = ghUser.id ? Number(ghUser.id) : null;
        githubUsername = ghUser.login || "";
        avatarUrl = ghUser.avatar_url || null;
      }
    } catch (err) {
      console.warn("Could not fetch user with provider_token:", err);
    }
  }

  // 2. Extract strictly from verified provider identity (user.identities) where provider === 'github'
  // NEVER use unverified user_metadata
  if (!githubUserId || !githubUsername) {
    const githubIdentity = user.identities?.find((i) => i.provider === "github");
    if (githubIdentity) {
      const identityData = (githubIdentity.identity_data || {}) as Record<string, unknown>;
      const rawId =
        identityData.provider_id ||
        githubIdentity.id ||
        identityData.sub;

      if (rawId) {
        const parsed = parseInt(String(rawId), 10);
        if (!isNaN(parsed)) {
          githubUserId = parsed;
        }
      }

      const rawLogin =
        identityData.user_name ||
        identityData.login ||
        identityData.preferred_username;

      if (typeof rawLogin === "string" && rawLogin.trim().length > 0) {
        githubUsername = rawLogin.trim();
      }

      if (!avatarUrl && typeof identityData.avatar_url === "string") {
        avatarUrl = identityData.avatar_url;
      }
    }
  }

  // If verified GitHub identity is absent, reject immediately
  if (!githubUserId || !githubUsername) {
    console.error("Missing required verified GitHub provider identity");
    return NextResponse.redirect(
      new URL("/error?error=missing_github_profile", appOrigin)
    );
  }

  // Upsert profile using service client (bypasses RLS since profiles has no authenticated INSERT policy)
  const serviceClient = createServiceClient();
  const { error: profileError } = await serviceClient.from("profiles").upsert(
    {
      id: user.id,
      github_user_id: githubUserId,
      github_username: githubUsername,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.error("Profile upsert failed:", profileError.message);
    return NextResponse.redirect(
      new URL("/error?error=profile_creation_failed", appOrigin)
    );
  }

  // Redirect strictly to appOrigin (never trust Host or X-Forwarded-Host)
  return NextResponse.redirect(new URL(next, appOrigin));
}
