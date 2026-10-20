"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const isReposActive =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand header */}
        <div className="flex h-16 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-bold text-lg tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 rounded"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm">
              PR
            </span>
            <span>PRPilot</span>
          </Link>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 lg:hidden cursor-pointer"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Navigation links */}
        <nav className="flex-1 space-y-1 p-4" aria-label="Dashboard navigation">
          <Link
            href="/dashboard"
            onClick={onClose}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
              isReposActive
                ? "bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 font-semibold"
                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <svg
              className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            Repositories
          </Link>
        </nav>

        {/* Footer info / GitHub App helper */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 text-xs text-zinc-500">
          <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            PRPilot GitHub App
          </p>
          <p className="leading-relaxed">
            AI-powered code reviews for your pull requests.
          </p>
        </div>
      </aside>
    </>
  );
}
