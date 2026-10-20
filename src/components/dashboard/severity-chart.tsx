"use client";

import React, { useSyncExternalStore } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { SeverityBreakdown } from "@/types";

interface SeverityChartProps {
  data: SeverityBreakdown[];
  hasError?: boolean;
}

const COLORS = {
  critical: "#f43f5e", // Rose 500
  warning: "#f59e0b", // Amber 500
  suggestion: "#71717a", // Zinc 500
  praise: "#10b981", // Emerald 500
};

export function SeverityChart({ data, hasError = false }: SeverityChartProps) {
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (hasError) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col items-center justify-center text-center min-h-[320px]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-3">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Unable to load severity breakdown
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs">
          Something went wrong while calculating findings statistics.
        </p>
      </div>
    );
  }

  const hasData =
    data.length > 0 &&
    data.some(
      (d) =>
        (d.critical || 0) +
          (d.warning || 0) +
          (d.suggestion || 0) +
          (d.praise || 0) >
        0
    );

  if (!hasData) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col items-center justify-center text-center min-h-[320px]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 mb-3">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          No severity data available
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs">
          Findings will appear here once pull requests are reviewed.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Severity Breakdown
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Daily findings categorized by severity level.
          </p>
        </div>
      </div>

      {/* Visual Chart */}
      <div className="h-[260px] w-full pt-2">
        {isMounted ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart
              data={data}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                stroke="#888888"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#888888"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2.5 shadow-md text-xs space-y-1">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">
                          {String(label)}
                        </p>
                        {payload.map((entry, index) => (
                          <div
                            key={`item-${index}`}
                            className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-300"
                          >
                            <span className="capitalize flex items-center gap-1.5">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: entry.color }}
                              />
                              {entry.name}:
                            </span>
                            <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                              {entry.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              />
              <Bar
                dataKey="critical"
                name="Critical"
                stackId="a"
                fill={COLORS.critical}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="warning"
                name="Warning"
                stackId="a"
                fill={COLORS.warning}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="suggestion"
                name="Suggestion"
                stackId="a"
                fill={COLORS.suggestion}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="praise"
                name="Praise"
                stackId="a"
                fill={COLORS.praise}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full bg-zinc-100 dark:bg-zinc-800/40 rounded-lg animate-pulse" />
        )}
      </div>

      {/* Accessible Text Alternative (Table) */}
      <details className="text-xs group border-t border-zinc-100 dark:border-zinc-800/60 pt-2">
        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 select-none py-1 flex items-center justify-between">
          <span>View accessible data table</span>
          <span className="text-[10px] text-zinc-400 group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="overflow-x-auto pt-2">
          <table
            className="w-full text-left border-collapse"
            aria-label="Severity Breakdown Data Table"
          >
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                <th className="py-1 px-2 font-medium">Date</th>
                <th className="py-1 px-2 font-medium text-rose-600 dark:text-rose-400">Critical</th>
                <th className="py-1 px-2 font-medium text-amber-600 dark:text-amber-400">Warning</th>
                <th className="py-1 px-2 font-medium text-zinc-500">Suggestion</th>
                <th className="py-1 px-2 font-medium text-emerald-600 dark:text-emerald-400">Praise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 text-zinc-700 dark:text-zinc-300 font-mono">
              {data.map((row) => (
                <tr key={row.date}>
                  <td className="py-1 px-2">{row.date}</td>
                  <td className="py-1 px-2">{row.critical}</td>
                  <td className="py-1 px-2">{row.warning}</td>
                  <td className="py-1 px-2">{row.suggestion}</td>
                  <td className="py-1 px-2">{row.praise}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
