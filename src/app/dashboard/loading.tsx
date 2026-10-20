import * as React from "react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading repositories">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="h-8 w-44 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
          <div className="h-4 w-72 bg-zinc-100 dark:bg-zinc-800 rounded-md mt-2" />
        </div>
        <div className="h-9 w-36 bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="flex flex-col justify-between border-zinc-200 dark:border-zinc-800">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="h-5 w-36 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
                <div className="h-4 w-12 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
              </div>
            </CardHeader>

            <CardContent>
              <div className="flex items-center justify-between">
                <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
                <div className="h-5 w-16 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
              </div>
            </CardContent>

            <CardFooter className="border-t border-zinc-100 dark:border-zinc-800/60 pt-4 flex items-center justify-between">
              <div className="h-3 w-28 bg-zinc-100 dark:bg-zinc-800 rounded-md" />
              <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
