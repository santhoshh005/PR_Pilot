# PRPilot

PRPilot is an autonomous AI-powered GitHub App that automatically reviews pull requests, analyzes unified diffs, detects security vulnerabilities and architectural anti-patterns, generates structured inline comments, and computes overall risk scores using Google Gemini.

---

## Architecture Overview

- **Frontend & App Router**: Next.js 16 (React 19, Turbopack, Tailwind CSS v4, Lucide Icons, Recharts).
- **Backend & Database**: Supabase PostgreSQL with strict Row Level Security (RLS) and serverless TypeScript route handlers.
- **AI Engine**: Google Gemini API via `@google/genai` (structured JSON review output).
- **GitHub Integration**: Octokit (`@octokit/auth-app`, `@octokit/rest`, `@octokit/webhooks-methods`) for PR diff retrieval and automated review posting.
- **Hybrid Processing**: Primary path starts processing immediately in the background serverless execution via Vercel `waitUntil` upon receiving a `pull_request` webhook; fallback path uses a scheduled GitHub Actions cron to recover stuck, queued, or deferred jobs (every 30 minutes on private repositories, every 5 minutes on public repositories).

---

## Prerequisites

- **Node.js**: `v20.x`, `v22.x`, or `v24.x` (LTS or current)
- **Package Manager**: `pnpm` (v12.x)
- **Supabase Account**: A Supabase project with executed migrations (`supabase/migrations/`)
- **Google AI Studio**: An API key with access to Gemini models
- **GitHub Account**: Permissions to create and install a GitHub App

---

## Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/<your-username>/PR_Pilot.git
   cd PR_Pilot
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Configure environment variables**:
   Create a `.env.local` file at the root:
   ```bash
   cp .env.local.example .env.local
   ```
   Fill in the required environment variables (see [Environment Variables](#environment-variables) below).

4. **Run the local development server**:
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the application.

---

## Verification & Testing Commands

Run the full testing and quality suite locally:

```bash
# 1. Code linting
pnpm lint

# 2. TypeScript static type checking
pnpm type-check

# 3. Unit and component tests (Vitest)
pnpm test

# 4. Playwright End-to-End tests
pnpm test:e2e

# 5. Production build verification
pnpm build
```

---

## Environment Variables

All required environment variables defined in `SECURITY.md` and `.env.local.example`:

| Variable | Scope | Location | Secret? | Description |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Build-Time** (inlined) | Vercel / `.env.local` | No | Supabase project URL (`https://<project-ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Build-Time** (inlined) | Vercel / `.env.local` | No | Supabase anonymous / public key safe for client-side bundle. |
| `NEXT_PUBLIC_APP_URL` | **Build-Time** (inlined) | Vercel / `.env.local` | No | Base application URL (`http://localhost:3000` or `https://<app>.vercel.app`). |
| `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL` | **Build-Time** (inlined) | Vercel / `.env.local` | No | Optional direct URL to install GitHub App, displayed in dashboard empty state. |
| `GITHUB_APP_ID` | **Runtime-Only** | Vercel / `.env.local` | No | Numeric ID of the GitHub App. |
| `GITHUB_PRIVATE_KEY_BASE64` | **Runtime-Only** | Vercel / `.env.local` | **Yes** | **Recommended**: Base64-encoded private key (.pem) to eliminate newline escaping issues in Vercel. |
| `GITHUB_PRIVATE_KEY` | **Runtime-Only** | Vercel / `.env.local` | **Yes** | Supported alternative: RSA private key (.pem) from GitHub App (multiline or `\n` escaped). |
| `GITHUB_WEBHOOK_SECRET` | **Runtime-Only** | Vercel / `.env.local` | **Yes** | Random 32+ character HMAC secret for webhook signature verification. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Runtime-Only** | Vercel / `.env.local` | **Yes** | Supabase service-role secret key (bypasses RLS on server only). |
| `GEMINI_API_KEY` | **Runtime-Only** | Vercel / `.env.local` | **Yes** | Google Gemini API key from Google AI Studio. |
| `CRON_SECRET` | **Runtime-Only** | Vercel / `.env.local` | **Yes** | Bearer authorization token protecting `/api/cron/process-reviews`. |
| `GEMINI_MODEL` | **Runtime-Only** | Vercel / `.env.local` | No | Model name (default: `gemini-3.8-flash`). |
| `GEMINI_DAILY_LIMIT` | **Runtime-Only** | Vercel / `.env.local` | No | Daily request budget cap (e.g. `15` free tier, `1500` standard). |
| `GEMINI_CONCURRENCY` | **Runtime-Only** | Vercel / `.env.local` | No | Max concurrent chunk LLM requests (default: `2`). |
| `GEMINI_THINKING_LEVEL` | **Runtime-Only** | Vercel / `.env.local` | No | Thinking budget for Flash models: `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` (default: `LOW`). |
| `GEMINI_MAX_OUTPUT_TOKENS` | **Runtime-Only** | Vercel / `.env.local` | No | Maximum token limit for Gemini output (1024–65536, default: `4096`). |

> [!NOTE]
> Next.js inlines `NEXT_PUBLIC_*` variables into client-side JavaScript bundles at build time. Changing any `NEXT_PUBLIC_*` variable in Vercel Project Settings requires triggering a **Redeploy** for changes to take effect in the browser. Server-only runtime variables are read on-demand by Serverless Functions. Build tolerance allows `next build` to complete successfully even when GitHub runtime credentials are unset during initial provisioning.
>
> **Recommended Private Key Setup**: To avoid newline stripping or quote escaping issues in Vercel's web UI, set `GITHUB_PRIVATE_KEY_BASE64` using base64. Generate it directly to clipboard on Windows (PowerShell):
> ```powershell
> [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\key.pem")) | Set-Clipboard
> ```

---

## Security Model

- **Signature-verified webhooks with idempotency**: Every webhook from GitHub is verified via HMAC-SHA256 (`X-Hub-Signature-256`) on raw request bytes using constant-time timing-safe comparison, and deduplicated against the `webhook_deliveries` table.
- **Row-Level Security (RLS) on every table**: RLS is strictly enabled across all application tables (`repos`, `repo_settings`, `review_jobs`, `review_chunks`, `reviews`, `review_comments`, `installations`, `profiles`); authenticated users can only access their own repositories, settings, and reviews.
- **Anon role has no table access**: The Supabase `anon` role is explicitly revoked from `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on all application tables.
- **Internal table privilege isolation**: Tables `daily_api_usage`, `webhook_deliveries`, `rate_limits`, and `review_chunks` have all privileges revoked from `authenticated`, `anon`, and `PUBLIC`; access is granted strictly to `service_role`.
- **Profile identity immutability**: Authenticated users cannot modify their `github_user_id` or `github_username`; these fields are protected by an explicit SQL trigger (`protect_profile_identity`) and revoked column-level `UPDATE` grants.
- **Server-side-only service role**: The privileged `service_role` key is strictly confined to server-side route handlers and background jobs; it is never bundled into client bundles or exposed to the browser.
- **Postgres-backed rate limiting with memory fallback**: Protected API endpoints enforce rate limits via atomic Postgres RPC (`check_rate_limit`) on the `rate_limits` table with a bounded 50,000-row cap and eager expired-entry pruning. If the database is unreachable, routes fail open to an in-memory sliding window rate limiter.
- **Untrusted AI output rendering**: All AI model outputs are treated as untrusted data, validated against a strict Zod schema, sanitized, and rendered strictly as plain text in the UI to prevent XSS. Code suggestions are displayed as plain read-only markdown diffs and are never rendered as one-click apply blocks or executable code.
- **Pinned GitHub Actions**: All CI workflow actions are pinned to immutable 40-character commit SHAs with Dependabot configured for automated weekly updates.

---

## Known Limitations

- **Gemini free-tier daily quota**: The live demo runs on the Gemini free tier, so on a busy day reviews may be deferred when the daily request budget is reached. The application tracks daily Gemini calls in the `daily_api_usage` table with a date key formatted as `YYYY-MM-DD` in UTC (`new Date().toISOString().slice(0, 10)`), which resets at midnight UTC (00:00 UTC). An atomic `reserve_daily_api_usage` SQL function locks and reserves quotas to eliminate concurrency races. Note that Google's own API quota resets on its own schedule (Pacific Time, midnight PT) and may differ from our UTC counter.
- **Personal-account installations only**: Organization installations are ignored in v1 (`account_type === 'User'` enforced during installation sync).
- **Head commit deduplication**: Two pull requests within the same repository that share the identical head commit SHA reuse the single review result.
- **Initial repository sync & backfill**: When repositories are first synced (via the "Sync Repositories" button in the dashboard or upon initial installation), PRPilot automatically backfills open, non-draft pull requests (up to 5 per repository, capped at 20 total per sync) and enqueues them as pending review jobs. Subsequent PR reviews are triggered via `pull_request` webhooks.
- **Review trigger and cron fallback cadence**: A `pull_request` webhook starts processing immediately in the background serverless execution via `@vercel/functions` `waitUntil`. The scheduled cron (`POST /api/cron/process-reviews` via `.github/workflows/cron.yml`) is solely a fallback safety net for stuck, queued, or deferred jobs (running every 30 minutes on a private repository, or every 5 minutes on a public one).
- **Postgres-backed rate limiter (fails open with memory fallback)**: The rate limiter uses Postgres exclusively (`rate_limits` table with atomic RPC `check_rate_limit`) with no external caching dependencies. All protected routes—webhook (`/api/webhook`), fallback cron (`/api/cron/process-reviews`), auth (`/api/auth/callback`, `/api/auth/signout`), and dashboard API (`/api/repos`, `/api/repos/[repoId]/*`)—fail open (`failOpen: true`) using an in-memory sliding window fallback if the limiter encounters a database error, preventing service outages during transient database connectivity hiccups. The `rate_limits` table enforces a bounded 50,000 row hard cap with eager expired row pruning.
- **Repository content access & AI analysis boundary**: The app can read repository contents of the repositories it is installed on (it only fetches pull request diffs and sends them to the Gemini API for analysis), and users should install it only on repositories they are comfortable sending to Google's Gemini API; the free tier's data-use terms may differ from paid, to be checked by the user.

---

## GitHub App Configuration

1. In GitHub, go to **Settings > Developer Settings > GitHub Apps > New GitHub App**.
2. Configure core fields:
   - **App name**: `prpilot-<your-unique-suffix>`
   - **Homepage URL**: `https://<your-app>.vercel.app`
   - **Callback URL**: `https://<project-ref>.supabase.co/auth/v1/callback` (for project `ajsvejrikxaqztbnctwj`: `https://ajsvejrikxaqztbnctwj.supabase.co/auth/v1/callback`). *Note: GitHub redirects to Supabase Auth here; do not set this to `/api/auth/callback`.*
   - **Setup URL (Redirect after installation)**: `https://<your-app>.vercel.app/dashboard`
   - **Request user authorization (OAuth) during installation**: Checked
3. Configure webhook:
   - **Webhook URL**: `https://<your-app>.vercel.app/api/webhook`
   - **Webhook secret**: Generated string matching `GITHUB_WEBHOOK_SECRET`
4. Configure permissions (least privilege):
   - **Pull requests**: `Read & write` — Pull requests to read PR metadata and post reviews.
   - **Contents**: `Read-only` — Contents read-only because GitHub requires it to return a pull request's diff (read-only: the app cannot change code).
   - **Metadata**: `Read-only` — Metadata is mandatory.
   - *All other permissions*: `No access`
5. Under **Subscribe to events**, select **Pull request**.
6. Set **Where can this GitHub App be installed?** to **Only on this account**.
7. Create the app, copy the numeric **App ID**, generate a **Client Secret** (under Client secrets), and generate a **Private key** (`.pem` file).

---

## Deployment Sequence & Vercel Configuration

For a detailed step-by-step checklist with `[YOU]` vs `[AGENT]` responsibility markers, consult [`MANUAL_STEPS.md`](./MANUAL_STEPS.md). To avoid circular dependency traps:

1. **Push Code**: Commit and push all code to GitHub on `main`.
2. **Initial Vercel Import & Domain Claim**: Import repository into Vercel, assign project name to claim canonical domain (`https://<your-project>.vercel.app`), populate known Supabase, Gemini, and Cron variables, and deploy.
3. **Supabase Auth URL Configuration**: In Supabase Dashboard > Authentication > URL Configuration:
   - Set **Site URL** to `https://<your-project>.vercel.app`.
   - Add `http://localhost:3000/**` and `https://<your-project>.vercel.app/**` to **Redirect URLs**.
4. **Register GitHub App**: Register the app using the canonical Vercel domain for Webhook/Setup and the Supabase callback URL for Callback URL. Obtain App ID, Client ID, Client Secret, and Private Key.
5. **Enable GitHub Provider in Supabase**: In Supabase Dashboard > Authentication > Providers > GitHub, enable GitHub and enter the GitHub App's Client ID and Client Secret.
6. **Populate GitHub Variables in Vercel & Redeploy**: Add `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL` in Vercel Project Settings and trigger a **Redeploy**.
7. **Vercel Deployment Protection**: In Vercel Project Settings > Deployment Protection, ensure Vercel Authentication is disabled for Production (or configure Protection Bypass for Automation) so GitHub webhooks and cron triggers are not blocked by 401/307 authentication challenges.
8. **Configure GitHub Actions Cron**: In GitHub repo Settings > Secrets and variables > Actions, configure repository secret `CRON_SECRET` and variable `APP_URL`.
9. **Install App & Test**: Install the GitHub App on your personal account and open a test PR to verify the end-to-end review flow. (If updating permissions on an existing GitHub App rather than a new install, the installation owner must accept the updated permissions at `github.com/settings/installations`, otherwise requests will continue to fail with 403).

---

## Scheduled Fallback Cron Workflow

The fallback review processor is triggered by GitHub Actions in `.github/workflows/cron.yml` to resume incomplete or stale reviews:

- Schedule: runs every 30 minutes (`*/30 * * * *`) by default (or every 5 minutes if configured).
- Requires two repository settings in GitHub:
  1. **Repository secret** `CRON_SECRET`: matches the `CRON_SECRET` in Vercel.
  2. **Repository variable** `APP_URL`: your production app URL (e.g. `https://prpilot.vercel.app`, no trailing slash).
- Skips execution automatically until `APP_URL` is configured, preventing false failure notifications prior to deployment.
