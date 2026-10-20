import React from "react";

export default function ReviewDetailLoading() {
  return (
    <div
      className="space-y-6 max-w-4xl animate-pulse"
      aria-busy="true"
      aria-label="Loading review details"
    >
      <div className="h-4 w-48 bg-zinc-200 dark:bg-zinc-800 rounded-md" />

      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-4 w-72 bg-zinc-100 dark:bg-zinc-800 rounded-md mt-2" />
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <div className="h-5 w-32 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-16 w-full bg-zinc-100 dark:bg-zinc-800 rounded-md" />
      </div>

      <div className="space-y-4">
        <div className="h-5 w-40 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
        {[1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3 bg-white dark:bg-zinc-900"
          >
            <div className="h-4 w-36 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
            <div className="h-4 w-48 bg-zinc-100 dark:bg-zinc-800 rounded-md" />
            <div className="h-12 w-full bg-zinc-100 dark:bg-zinc-800 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
