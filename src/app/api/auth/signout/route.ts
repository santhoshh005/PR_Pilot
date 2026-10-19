import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
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

export async function GET(request: Request) {
  return POST(request);
}
