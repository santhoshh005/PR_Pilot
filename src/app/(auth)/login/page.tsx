import { createUserClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const instant = false;

function getAppOrigin(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // invalid URL
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL must be configured in production");
  }
  return "http://localhost:3000";
}

export default async function LoginPage() {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  async function signInWithGitHub() {
    "use server";
    const origin = getAppOrigin();

    const client = await createUserClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${origin}/api/auth/callback`,
      },
    });

    if (error || !data?.url) {
      redirect("/error?error=oauth_init_failed");
    }

    redirect(data.url);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-sm">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm mb-4">
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
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Sign in to PRPilot
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-sm">
            Autonomous, high-signal AI code reviews for pull requests. Connect with GitHub to get started.
          </p>
        </div>

        {/* OAuth Form */}
        <form action={signInWithGitHub} className="mt-8">
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
          >
            {/* GitHub Logo SVG */}
            <svg
              className="h-5 w-5 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            <span>Continue with GitHub</span>
          </button>
        </form>

        <div className="mt-6 border-t border-zinc-100 dark:border-zinc-800/80 pt-6 text-center">
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            By continuing, you agree to PRPilot terms. We only request permissions necessary to analyze pull requests.
          </p>
          <div className="mt-4">
            <Link
              href="/"
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            >
              ← Back to Homepage
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
