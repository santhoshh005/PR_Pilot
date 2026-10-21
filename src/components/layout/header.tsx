import * as React from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { SyncButton } from "@/components/dashboard/sync-button";

export interface HeaderProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      user_name?: string;
      avatar_url?: string;
    };
  };
  onMenuToggle?: () => void;
}

export function Header({ user, onMenuToggle }: HeaderProps) {
  const username =
    user.user_metadata?.user_name ||
    user.email?.split("@")[0] ||
    "Developer";
  const avatarUrl = user.user_metadata?.avatar_url;

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 px-4 md:px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            aria-label="Toggle navigation menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 lg:hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
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
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        )}

        <div className="flex items-center gap-2 lg:hidden font-bold text-base tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs">
            PR
          </span>
          <span>PRPilot</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SyncButton
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex"
        >
          Sync Repos
        </SyncButton>

        <div className="flex items-center gap-2 pl-2 border-l border-zinc-200 dark:border-zinc-800">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={username}
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 rounded-full border border-zinc-200 dark:border-zinc-700 object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {username.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="hidden md:inline-block text-sm font-medium text-zinc-800 dark:text-zinc-200 max-w-[140px] truncate">
            {username}
          </span>
        </div>

        <form action="/api/auth/signout" method="POST">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Sign Out
          </Button>
        </form>
      </div>
    </header>
  );
}
