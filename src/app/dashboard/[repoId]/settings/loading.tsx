import React from "react";

export default function SettingsLoading() {
  return (
    <div
      className="space-y-6 max-w-4xl animate-pulse"
      aria-busy="true"
      aria-label="Loading repository settings"
    >
      {/* Breadcrumb skeleton */}
      <div className="h-4 w-48 bg-zinc-200 dark:bg-zinc-800 rounded-md" />

      {/* Header skeleton */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-4 w-96 bg-zinc-100 dark:bg-zinc-800 rounded-md mt-2" />
      </div>

      {/* Form container skeleton */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
          <div className="h-10 w-64 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        </div>

        <div className="space-y-2">
          <div className="h-4 w-40 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
          <div className="h-28 w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        </div>

        <div className="space-y-2">
          <div className="h-4 w-36 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
          <div className="h-28 w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        </div>

        <div className="h-9 w-32 bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
      </div>
    </div>
  );
}
