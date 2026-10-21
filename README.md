# PRPilot

PRPilot is an autonomous AI-powered GitHub App that automatically reviews pull requests, analyzes unified diffs, detects security vulnerabilities and architectural anti-patterns, generates structured inline comments, and computes overall risk scores using Google Gemini.

---

## Architecture Overview

- **Frontend & App Router**: Next.js 16 (React 19, Turbopack, Tailwind CSS v4, Lucide Icons, Recharts).
- **Backend & Database**: Supabase PostgreSQL with strict Row Level Security (RLS) and serverless TypeScript route handlers.
- **AI Engine**: Google Gemini API via `@google/genai` (structured JSON review output).
- **GitHub Integration**: Octokit (`@octokit/auth-app`, `@octokit/rest`, `@octokit/webhooks-methods`) for PR diff retrieval and automated review posting.
- **Hybrid Processing**: Primary path uses Vercel `waitUntil` for immediate analysis; fallback path uses GitHub Actions scheduled cron to recover stale/large jobs.

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

## Known Limitations

- **Personal-account installations only**: Organization installations are ignored in v1 (`account_type === 'User'` enforced during installation sync).
- **Head commit deduplication**: Two pull requests within the same repository that share the identical head commit SHA reuse the single review result.
- **Gemini free-tier daily quota**: On free-tier Gemini API keys, exhausting the daily request or token budget defers pending review jobs until quota resets the following day.
- **Fail-open rate limiting**: In-memory and database rate limit checks fail open if the database connection encounters an unexpected transient error.
- **Cron fallback cadence**: Scheduled fallback review processing runs every 30 minutes on private repositories (or every 5 minutes on public repositories) due to GitHub Actions scheduled workflow limitations.
- **Initial repository sync**: Pull requests opened on repositories before the initial repository sync is triggered (via the "Sync Repositories" button in the dashboard) are not reviewed.

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
3. Add all 9 environment variables listed above under **Project Settings > Environment Variables** for Production and Preview environments.
4. Deploy the project and copy your production domain.
5. In Supabase Dashboard:
   - Navigate to **Authentication > URL Configuration**.
   - Set **Site URL** to `https://<your-app>.vercel.app`.
   - Add `https://<your-app>.vercel.app/api/auth/callback` to **Redirect URLs**.

---

## Scheduled Fallback Cron Workflow

The fallback review processor is triggered by GitHub Actions in `.github/workflows/cron.yml` to resume incomplete or stale reviews:

- Schedule: runs every 30 minutes (`*/30 * * * *`) by default (or every 5 minutes if configured).
- Requires two repository settings in GitHub:
  1. **Repository secret** `CRON_SECRET`: matches the `CRON_SECRET` in Vercel.
  2. **Repository variable** `APP_URL`: your production app URL (e.g. `https://prpilot.vercel.app`, no trailing slash).
- Skips execution automatically until `APP_URL` is configured, preventing false failure notifications prior to deployment.
