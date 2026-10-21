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

All 9 required environment variables defined in `SECURITY.md`:

| Variable | Location | Secret? | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | Vercel / `.env.local` | No | Numeric ID of the GitHub App. |
| `GITHUB_PRIVATE_KEY` | Vercel / `.env.local` | **Yes** | RSA private key (.pem) downloaded from GitHub App settings. |
| `GITHUB_WEBHOOK_SECRET` | Vercel / `.env.local` | **Yes** | Random 32+ character HMAC secret for webhook signature verification. |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel / `.env.local` | No | Supabase project URL (`https://<project-ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel / `.env.local` | No | Supabase anonymous / public key safe for client-side bundle. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel / `.env.local` | **Yes** | Supabase service-role secret key (bypasses RLS on server only). |
| `GEMINI_API_KEY` | Vercel / `.env.local` | **Yes** | Google Gemini API key from Google AI Studio. |
| `CRON_SECRET` | Vercel / `.env.local` | **Yes** | Bearer authorization token protecting the `/api/cron/process-reviews` endpoint. |
| `NEXT_PUBLIC_APP_URL` | Vercel / `.env.local` | No | Base application URL (`http://localhost:3000` or `https://<app>.vercel.app`). |
| `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL` | Vercel / `.env.local` | No | Optional direct URL to install the GitHub App, displayed as an action link in the dashboard empty state. |

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

---

## GitHub App Configuration

1. In GitHub, go to **Settings > Developer Settings > GitHub Apps > New GitHub App**.
2. Set **App name**, **Homepage URL**, and **Callback URL** (`https://<your-app>.vercel.app/api/auth/callback` or `http://localhost:3000/api/auth/callback`).
3. Check **Request user authorization (OAuth) during installation**.
4. Set **Webhook URL** to `https://<your-app>.vercel.app/api/webhook`.
5. Set **Webhook secret** to the random string matching `GITHUB_WEBHOOK_SECRET`.
6. Configure **Permissions**:
   - **Pull requests**: `Read & write` (fetch diffs, post review comments and summaries)
   - **Metadata**: `Read-only` (default GitHub requirement)
   - *All other permissions*: `No access`
7. Under **Subscribe to events**, select **Pull request**.
8. Generate and download a **Private key** (`.pem`) and note the **App ID**.

---

## Vercel Deployment Configuration

Deployment is handled natively via Vercel's GitHub integration on every push to the `main` branch.

1. Import the repository into [Vercel](https://vercel.com).
2. Configure project settings:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: `./`
   - **Build Command**: `pnpm build`
   - **Install Command**: `pnpm install`
3. Add the 10 environment variables listed above under **Project Settings > Environment Variables** for Production and Preview environments.
4. Deploy the project and copy your production domain.
5. In Supabase Dashboard:
   - Navigate to **Authentication > URL Configuration**.
   - Set **Site URL** to `https://<your-app>.vercel.app`.
   - Under **Redirect URLs**, add the required allow-list patterns:
     - `http://localhost:3000/**` (Local development)
     - `https://<your-app>.vercel.app/**` (Production)
   - **Vercel Preview Deployments**: Dynamic branch preview URLs (e.g. `https://prpilot-git-*.vercel.app`) are **not** accepted for OAuth unless an account-scoped pattern (such as `https://*-<your-team-or-account-slug>.vercel.app/**`) is explicitly added to Supabase Auth Redirect URLs, and `NEXT_PUBLIC_APP_URL` is set accordingly (never use un-scoped `https://*.vercel.app/**`). Otherwise, sign-in attempts on preview deployments will be rejected by Supabase Auth or redirected back to the configured production `NEXT_PUBLIC_APP_URL`.

---

## Scheduled Fallback Cron Workflow

The fallback review processor is triggered by GitHub Actions in `.github/workflows/cron.yml` to resume incomplete or stale reviews:

- Schedule: runs every 30 minutes (`*/30 * * * *`) by default (or every 5 minutes if configured).
- Requires two repository settings in GitHub:
  1. **Repository secret** `CRON_SECRET`: matches the `CRON_SECRET` in Vercel.
  2. **Repository variable** `APP_URL`: your production app URL (e.g. `https://prpilot.vercel.app`, no trailing slash).
- Skips execution automatically until `APP_URL` is configured, preventing false failure notifications prior to deployment.
