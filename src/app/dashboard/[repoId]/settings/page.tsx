import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { SettingsForm, RepoSettingsData } from "@/components/dashboard/settings-form";

export const instant = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SettingsPageProps {
  params: Promise<{ repoId: string }>;
}

export default async function RepoSettingsPage({ params }: SettingsPageProps) {
  const { repoId } = await params;

  // Validate UUID
  if (!repoId || !UUID_REGEX.test(repoId)) {
    notFound();
  }

  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let repo: {
    id: string;
    full_name: string;
    name: string;
    owner: string;
    is_active: boolean;
  } | null = null;

  let settings: RepoSettingsData = {
    strictness: "balanced",
    custom_instructions: "",
    ignored_paths: [],
  };

  let hasError = false;

  try {
    // 1. Fetch Repository
    const { data: repoData, error: repoError } = await userClient
      .from("repos")
      .select("id, full_name, name, owner, is_active")
      .eq("id", repoId)
      .single();

    if (repoError || !repoData) {
      if (repoError?.code === "PGRST116" || (!repoError && !repoData)) {
        notFound();
      }
      console.error(
        "[SETTINGS_PAGE] Failed to fetch repository:",
        repoError?.message
      );
      hasError = true;
    } else {
      repo = repoData;
    }

    if (repo) {
      // 2. Fetch Repository Settings
      const { data: settingsData, error: settingsError } = await userClient
        .from("repo_settings")
        .select("strictness, custom_instructions, ignored_paths")
        .eq("repo_id", repoId)
        .single();

      if (settingsError && settingsError.code !== "PGRST116") {
        console.error(
          "[SETTINGS_PAGE] Failed to fetch repo settings:",
          settingsError.message
        );
        hasError = true;
      } else if (settingsData) {
        settings = {
          strictness: settingsData.strictness || "balanced",
          custom_instructions: settingsData.custom_instructions || "",
          ignored_paths: settingsData.ignored_paths || [],
        };
      }
    }
  } catch (err: unknown) {
    const errorObj = err as { message?: string; digest?: string } | null;
    const msg = errorObj?.message || "";
    const digest = errorObj?.digest || "";
    if (msg.startsWith("NEXT_") || digest.startsWith("NEXT_")) {
      throw err;
    }
    console.error("[SETTINGS_PAGE] Unexpected error:", errorObj?.message || err);
    hasError = true;
  }

  // Generic Error State
  if (hasError || !repo) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center shadow-xs">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-4">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Unable to load settings
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          Something went wrong while loading repository settings. Please try refreshing the page.
        </p>
        <div className="mt-6">
          <Link
            href={`/dashboard/${repoId}/settings`}
            className="inline-flex items-center justify-center rounded-lg font-medium transition-colors border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 h-8 px-3 text-xs gap-1.5"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
        <Link href="/dashboard" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
          Repositories
        </Link>
        <span>/</span>
        <Link
          href={`/dashboard/${repoId}`}
          className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          {repo.full_name}
        </Link>
        <span>/</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          Settings
        </span>
      </nav>

      {/* Header */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Repository Settings
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Configure AI review preferences, strictness, and exclusions for{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {repo.full_name}
          </span>
          .
        </p>
      </div>

      {/* Settings Form Container */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xs">
        <SettingsForm repoId={repoId} initialSettings={settings} />
      </div>
    </div>
  );
}
