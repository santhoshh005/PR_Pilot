import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserClient } from "@/lib/supabase/server";
import { checkDashboardRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { STRICTNESS_OPTIONS } from "@/lib/constants";
import { ApiError, RepoSettings } from "@/types";

const ParamsSchema = z.object({
  repoId: z.string().uuid("Invalid repository ID"),
});

export const PatchSettingsSchema = z
  .object({
    ignored_paths: z
      .array(
        z.string().max(300, "Ignored path pattern must not exceed 300 characters")
      )
      .max(100, "Maximum 100 ignored path patterns allowed")
      .optional(),
    strictness: z.enum(STRICTNESS_OPTIONS).optional(),
    custom_instructions: z
      .string()
      .max(2000, "Custom instructions must not exceed 2000 characters")
      .optional(),
  })
  .strict();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  try {
    const userClient = await createUserClient();
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      const errorResponse: ApiError = {
        error: "unauthorized",
        message: "Authentication required",
        status: 401,
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const rateLimit = await checkDashboardRateLimit(user.id);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfter);
    }

    const rawParams = await params;
    const parsedParams = ParamsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: parsedParams.error.issues[0]?.message || "Invalid repository ID",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const { repoId } = parsedParams.data;

    // Verify repo belongs to user (RLS-enforced)
    const { data: repo, error: repoError } = await userClient
      .from("repos")
      .select("id")
      .eq("id", repoId)
      .maybeSingle();

    if (repoError) {
      console.error("[GET_REPO_SETTINGS] Database error checking repo:", repoError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve repository settings",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!repo) {
      const errorResponse: ApiError = {
        error: "not_found",
        message: "Repository not found",
        status: 404,
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Query repo_settings via RLS
    const { data: settings, error: settingsError } = await userClient
      .from("repo_settings")
      .select("*")
      .eq("repo_id", repoId)
      .maybeSingle();

    if (settingsError) {
      console.error("[GET_REPO_SETTINGS] Database error querying settings:", settingsError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to retrieve repository settings",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!settings) {
      const errorResponse: ApiError = {
        error: "not_found",
        message: "Repository settings not found",
        status: 404,
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    return NextResponse.json(
      { settings: settings as RepoSettings },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[GET_REPO_SETTINGS] Unexpected error:", error);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to retrieve repository settings",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  try {
    const userClient = await createUserClient();
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      const errorResponse: ApiError = {
        error: "unauthorized",
        message: "Authentication required",
        status: 401,
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const rateLimit = await checkDashboardRateLimit(user.id);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfter);
    }

    const rawParams = await params;
    const parsedParams = ParamsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: parsedParams.error.issues[0]?.message || "Invalid repository ID",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const { repoId } = parsedParams.data;

    let jsonBody: unknown;
    try {
      jsonBody = await request.json();
    } catch {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: "Invalid JSON body",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const parsedBody = PatchSettingsSchema.safeParse(jsonBody);
    if (!parsedBody.success) {
      const errorResponse: ApiError = {
        error: "bad_request",
        message: parsedBody.error.issues[0]?.message || "Validation failed",
        status: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Verify repo belongs to user (RLS-enforced)
    const { data: repo, error: repoError } = await userClient
      .from("repos")
      .select("id")
      .eq("id", repoId)
      .maybeSingle();

    if (repoError) {
      console.error("[PATCH_REPO_SETTINGS] Database error checking repo:", repoError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to update repository settings",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!repo) {
      const errorResponse: ApiError = {
        error: "not_found",
        message: "Repository not found",
        status: 404,
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const updates = {
      ...parsedBody.data,
      updated_at: new Date().toISOString(),
    };

    // Update settings via RLS
    const { data: updatedSettings, error: updateError } = await userClient
      .from("repo_settings")
      .update(updates)
      .eq("repo_id", repoId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      console.error("[PATCH_REPO_SETTINGS] Database error updating settings:", updateError.message);
      const errorResponse: ApiError = {
        error: "internal",
        message: "Failed to update repository settings",
        status: 500,
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    if (!updatedSettings) {
      const errorResponse: ApiError = {
        error: "not_found",
        message: "Repository settings not found",
        status: 404,
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    return NextResponse.json(
      { settings: updatedSettings as RepoSettings },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[PATCH_REPO_SETTINGS] Unexpected error:", error);
    const errorResponse: ApiError = {
      error: "internal",
      message: "Failed to update repository settings",
      status: 500,
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
