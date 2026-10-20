"use client";

import React, { useSyncExternalStore } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { RiskScoreTrend } from "@/types";

interface RiskTrendChartProps {
  data: RiskScoreTrend[];
  hasError?: boolean;
}

export function RiskTrendChart({ data, hasError = false }: RiskTrendChartProps) {
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
          Unable to load risk trend
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs">
          Something went wrong while calculating risk trajectory.
        </p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col items-center justify-center text-center min-h-[320px]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 mb-3">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          No risk trend data available
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs">
          Risk trends will appear here once pull requests are reviewed.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Risk Score Trend
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Average pull request risk score over time (0–100 scale).
          </p>
        </div>
      </div>

      {/* Visual Chart */}
      <div className="h-[260px] w-full pt-2">
        {isMounted ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <LineChart
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
                domain={[0, 100]}
                stroke="#888888"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const row = payload[0].payload as RiskScoreTrend;
                    return (
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2.5 shadow-md text-xs space-y-1">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">
                          {String(label)}
                        </p>
                        <div className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-300">
                          <span>Average Risk:</span>
                          <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                            {row.avg_risk_score}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-zinc-500 dark:text-zinc-400">
                          <span>Reviews:</span>
                          <span className="font-mono font-medium">{row.review_count}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line
                type="monotone"
                dataKey="avg_risk_score"
                name="Average Risk"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6366f1" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
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
            aria-label="Risk Score Trend Data Table"
          >
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                <th className="py-1 px-2 font-medium">Date</th>
                <th className="py-1 px-2 font-medium text-indigo-600 dark:text-indigo-400">Average Risk</th>
                <th className="py-1 px-2 font-medium">Reviews</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 text-zinc-700 dark:text-zinc-300 font-mono">
              {data.map((row) => (
                <tr key={row.date}>
                  <td className="py-1 px-2">{row.date}</td>
                  <td className="py-1 px-2">{row.avg_risk_score}</td>
                  <td className="py-1 px-2">{row.review_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
