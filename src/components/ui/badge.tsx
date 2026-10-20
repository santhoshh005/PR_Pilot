import * as React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "success" | "warning" | "destructive";
}

const badgeVariants: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default:
    "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-transparent",
  secondary:
    "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border-transparent",
  outline:
    "border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300",
  success:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  warning:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  destructive:
    "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
};

export function Badge({
  className = "",
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <div
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${badgeVariants[variant]} ${className}`}
      {...props}
    />
  );
}
