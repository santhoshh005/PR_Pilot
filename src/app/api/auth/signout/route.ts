import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, rateLimitResponse } from "@/lib/rate-limit";

function getAppOrigin(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // ignore invalid env URL
    }
  }
  return "http://localhost:3000";
}

export async function POST(request: Request) {
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const appOrigin = getAppOrigin();

  let isAllowedOrigin = false;
  if (originHeader) {
    try {
      isAllowedOrigin = new URL(originHeader).origin === appOrigin;
    } catch {
      isAllowedOrigin = false;
    }
  } else if (refererHeader) {
    try {
      isAllowedOrigin = new URL(refererHeader).origin === appOrigin;
    } catch {
      isAllowedOrigin = false;
    }
  }

  if (!isAllowedOrigin) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Cross-origin request rejected",
        status: 403,
      },
      { status: 403 }
    );
  }

  const rateLimit = await checkAuthRateLimit(request);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfter);
  }

  try {
    const supabase = await createUserClient();
    await supabase.auth.signOut();

    const redirectUrl = new URL("/", appOrigin);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (err) {
    console.error("Signout error:", err);
    const redirectUrl = new URL("/error?error=signout_failed", appOrigin);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}
