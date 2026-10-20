import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const rateLimit = await checkAuthRateLimit(request);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfter);
  }

  try {
    const supabase = await createUserClient();
    await supabase.auth.signOut();

    const redirectUrl = new URL("/", request.url);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (err) {
    console.error("Signout error:", err);
    const redirectUrl = new URL("/error?error=signout_failed", request.url);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}
