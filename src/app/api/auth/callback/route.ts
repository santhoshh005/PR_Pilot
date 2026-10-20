import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkAuthRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const rateLimit = await checkAuthRateLimit(request);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfter);
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const rawNext = requestUrl.searchParams.get("next");

  // Validate next URL to prevent open redirect vulnerabilities
  let next = "/dashboard";
  if (rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")) {
    next = rawNext;
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/error?error=missing_code", request.url)
    );
  }

  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error("Auth exchange error:", error?.message);
    return NextResponse.redirect(
      new URL("/error?error=auth_exchange_failed", request.url)
    );
  }

  const user = data.user;
  const session = data.session;

  let githubUserId: number | null = null;
  let githubUsername = "";
  let avatarUrl: string | null = null;

  // Capture GitHub user data using provider_token if available
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

  // Fall back to Supabase user metadata / identities if needed
  if (!githubUserId || !githubUsername) {
    const rawId =
      user.user_metadata?.provider_id ||
      user.user_metadata?.sub ||
      user.identities?.find((i) => i.provider === "github")?.identity_data
        ?.provider_id ||
      user.identities?.find((i) => i.provider === "github")?.id;

    if (rawId) {
      githubUserId = parseInt(String(rawId), 10);
    }

    githubUsername =
      githubUsername ||
      user.user_metadata?.user_name ||
      user.user_metadata?.preferred_username ||
      user.user_metadata?.name ||
      user.identities?.find((i) => i.provider === "github")?.identity_data
        ?.user_name ||
      "";

    avatarUrl =
      avatarUrl ||
      user.user_metadata?.avatar_url ||
      user.identities?.find((i) => i.provider === "github")?.identity_data
        ?.avatar_url ||
      null;
  }

  if (!githubUserId || !githubUsername) {
    console.error("Missing required GitHub profile information");
    return NextResponse.redirect(
      new URL("/error?error=missing_github_profile", request.url)
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
      new URL("/error?error=profile_creation_failed", request.url)
    );
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";

  if (!isLocalEnv && forwardedHost) {
    return NextResponse.redirect(new URL(next, `https://${forwardedHost}`));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
