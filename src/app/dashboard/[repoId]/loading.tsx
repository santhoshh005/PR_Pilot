import React from "react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";

export default function RepoLoading() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Loading repository reviews"
    >
      {/* Breadcrumb skeleton */}
      <div className="h-4 w-40 bg-zinc-200 dark:bg-zinc-800 rounded-md" />

      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="h-8 w-56 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
          <div className="h-4 w-72 bg-zinc-100 dark:bg-zinc-800 rounded-md mt-2" />
        </div>
        <div className="h-9 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
      </div>

      {/* Review cards skeleton */}
      <div className="grid grid-cols-1 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-zinc-200 dark:border-zinc-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="h-5 w-48 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
                <div className="h-4 w-16 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
              </div>
            </CardHeader>
            <CardContent className="pb-3 space-y-2">
              <div className="h-3 w-32 bg-zinc-100 dark:bg-zinc-800 rounded-md" />
              <div className="h-4 w-full bg-zinc-100 dark:bg-zinc-800 rounded-md" />
            </CardContent>
            <CardFooter className="pt-2 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/60">
              <div className="h-3 w-24 bg-zinc-100 dark:bg-zinc-800 rounded-md" />
              <div className="h-8 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
