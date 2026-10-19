import Link from "next/link";

export const instant = false;

interface ErrorPageProps {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "No authorization code was provided by the authentication provider.",
  auth_exchange_failed: "Failed to exchange the authorization code for a valid session.",
  missing_github_profile: "Could not retrieve your GitHub profile information.",
  profile_creation_failed: "Failed to create or update your user profile in the database.",
  oauth_init_failed: "Could not initialize authentication with GitHub.",
  signout_failed: "An error occurred while signing you out.",
};

export default async function AuthErrorPage({ searchParams }: ErrorPageProps) {
  const resolvedParams = await searchParams;
  const errorCode = resolvedParams.error;
  const description =
    (errorCode && ERROR_MESSAGES[errorCode]) ||
    "An unexpected error occurred during authentication. Please try again.";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400 mb-6">
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Authentication Error
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {description}
        </p>

        {errorCode && (
          <div className="mt-4 rounded-md bg-zinc-100 dark:bg-zinc-800/80 px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            code: {errorCode}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/login"
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Try Again
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
