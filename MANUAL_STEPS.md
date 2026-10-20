# PRPilot — Manual Setup & Deployment Checklist

This document details all configuration, provisioning, and deployment steps required to run PRPilot in production. Steps requiring personal account login, private credentials, or administrative privileges are marked **`[YOU]`**. Steps handled by the assistant or automated build pipelines are marked **`[AGENT]`**.

---

## 1. Creating the GitHub App

Navigate to GitHub: **Settings > Developer Settings > GitHub Apps > New GitHub App** (or your organization's Developer Settings).

- [ ] **[YOU]** **App name**: Choose a unique name, e.g., `PRPilot-Reviewer` (or `PRPilot-<your-github-username>`).
- [ ] **[YOU]** **Homepage URL**: Enter your landing page or temporary placeholder, e.g., `https://github.com/<your-username>/PR_Pilot` (or your planned Vercel URL).
- [ ] **[YOU]** **Callback URL**: Enter `http://localhost:3000/api/auth/callback` for local development, and add your production URL once deployed: `https://<your-app>.vercel.app/api/auth/callback`.
- [ ] **[YOU]** **Request user authorization (OAuth) during installation**: Check this box.
- [ ] **[YOU]** **Webhook URL**: Enter a temporary placeholder during initial creation (e.g., `https://smee.io/<channel>` for local development or `https://placeholder.example.com/api/webhook`), to be updated with `https://<your-app>.vercel.app/api/webhook` upon deployment.
- [ ] **[YOU]** **Webhook secret**: Generate a secure random string using:
  ```bash
  openssl rand -hex 32
  ```
  Paste this string into the GitHub App settings and save it securely for your `.env.local` / Vercel environment variables as `GITHUB_WEBHOOK_SECRET`.
- [ ] **[YOU]** **Repository Permissions** (request the exact permissions below and no more):
  - **Pull requests**: `Read & write` (required to read diffs, comment on PRs, and submit review summaries).
  - **Contents**: `Read-only` (required to inspect repo structure if needed).
  - **Metadata**: `Read-only` (automatically assigned by GitHub).
  - *All other permissions*: Leave as `No access`.
- [ ] **[YOU]** **Subscribe to Events**:
  - Check `Pull request` (handles `opened`, `synchronize`, `reopened`).
- [ ] **[YOU]** **Where can this GitHub App be installed?**: Select `Only on this account` (for personal use) or `Any account` if testing across multiple accounts.
- [ ] **[YOU]** **Create GitHub App**: Click **Create GitHub App**.
- [ ] **[YOU]** **Download & Save Credentials**:
  - Note the numeric **App ID** displayed on the app's General settings page.
  - Scroll down to the **Private keys** section and click **Generate a private key**.
  - A `.pem` file will download to your machine. Keep this file outside the repository.
- [ ] **[AGENT]** Verified that the diff parser, webhook validator, and Octokit client only request and use these exact permissions and events.

---

## 2. Environment Variables Checklist

Every environment variable defined in `.env.local.example` must be populated. Use this table as a reference:

| Environment Variable | Source / Generation Command | Secret? | Marked |
|---|---|---|---|
| `GITHUB_APP_ID` | From GitHub App General Settings (numeric ID). | No | **[YOU]** |
| `GITHUB_PRIVATE_KEY` | Contents of downloaded `.pem` file. For single-line env vars (e.g. Vercel), replace newlines with `\n` or paste multiline in Vercel UI. | **Yes** | **[YOU]** |
| `GITHUB_WEBHOOK_SECRET` | The random string generated in Step 1 via `openssl rand -hex 32`. | **Yes** | **[YOU]** |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard > Project Settings > API > Project URL (`https://<project-ref>.supabase.co`). | No | **[YOU]** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard > Project Settings > API > Project API Keys (`anon` / `public`). | No | **[YOU]** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard > Project Settings > API > Project API Keys (`service_role` secret). | **Yes** | **[YOU]** |
| `GEMINI_API_KEY` | Generated from Google AI Studio at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). | **Yes** | **[YOU]** |
| `GEMINI_MODEL` | Set model name, e.g., `gemini-3.8-flash` (or `gemini-2.5-flash`). | No | **[YOU]** |
| `GEMINI_DAILY_LIMIT` | Quota budget guard. E.g., `15` for conservative free-tier or `1500` for standard tier. | No | **[YOU]** |
| `GEMINI_CONCURRENCY` | Maximum concurrent chunk calls. Recommended: `2`. | No | **[YOU]** |
| `GEMINI_THINKING_LEVEL` | Thinking budget for Flash models. E.g., `LOW` or `OFF`. | No | **[YOU]** |
| `CRON_SECRET` | Generate a 32+ character random string via `openssl rand -hex 32`. | **Yes** | **[YOU]** |
| `NEXT_PUBLIC_APP_URL` | Local: `http://localhost:3000`. Production: `https://<your-vercel-domain>.vercel.app`. | No | **[YOU]** |

- [ ] **[YOU]** Run generation command for secrets:
  ```bash
  # Generate Webhook Secret
  openssl rand -hex 32

  # Generate Cron Secret
  openssl rand -hex 32
  ```
- [ ] **[AGENT]** Verified that `.env.local` is listed in `.gitignore` and that no keys or tokens are stored in the git tree.

---

## 3. Production Deployment

### A. Vercel Setup
- [ ] **[YOU]** Sign in to [Vercel](https://vercel.com) and click **Add New > Project**.
- [ ] **[YOU]** Import your GitHub repository (`PR_Pilot`).
- [ ] **[YOU]** Framework preset: Verify `Next.js` is selected.
- [ ] **[YOU]** Node.js version: Verify Node.js 18.x or 20.x is configured in Project Settings.
- [ ] **[YOU]** Build & Development Settings:
  - Install Command: `pnpm install`
  - Build Command: `pnpm build`
- [ ] **[YOU]** Environment Variables: Paste all variables from Section 2 above into the Vercel Project Settings for **Production** and **Preview**.
- [ ] **[YOU]** Click **Deploy** and wait for the build to finish. Copy your live deployment URL (e.g., `https://prpilot.vercel.app`).

### B. Supabase & GitHub OAuth Callback URL Updates
- [ ] **[YOU]** **Supabase Auth URL Configuration**:
  - Open Supabase Dashboard > Authentication > URL Configuration.
  - Set **Site URL** to `https://<your-app>.vercel.app`.
  - Under **Redirect URLs**, add `https://<your-app>.vercel.app/api/auth/callback`.
- [ ] **[YOU]** **GitHub App Webhook & Callback Update**:
  - Open GitHub App Settings.
  - Update **Webhook URL** to `https://<your-app>.vercel.app/api/webhook`.
  - Update **Callback URL** to `https://<your-app>.vercel.app/api/auth/callback`.

### C. GitHub Actions Cron Workflow Configuration
- [ ] **[YOU]** In your GitHub repository (`PR_Pilot`), navigate to **Settings > Secrets and variables > Actions**:
  - Under **Repository secrets**, click **New repository secret**:
    - Name: `CRON_SECRET`
    - Value: Paste the identical `CRON_SECRET` value configured in Vercel.
  - Under **Repository variables**, click **New repository variable**:
    - Name: `APP_URL`
    - Value: `https://<your-app>.vercel.app` (without trailing slash).
- [ ] **[AGENT]** Confirmed `.github/workflows/cron.yml` is configured to run on schedule `*/30 * * * *` and supports manual trigger via `workflow_dispatch`.

---

## 4. End-to-End Verification with a Throwaway Repository

- [ ] **[YOU]** Create a new throwaway repository on your GitHub personal account (e.g., `test-prpilot-sandbox`).
- [ ] **[YOU]** Install the GitHub App on the throwaway repository:
  - In GitHub App Settings > **Install App**, click **Install** next to your personal account.
  - Choose `Only select repositories` and pick `test-prpilot-sandbox`.
- [ ] **[YOU]** Open your deployed PRPilot dashboard (`https://<your-app>.vercel.app/login`) and authenticate via GitHub.
- [ ] **[YOU]** Trigger an installation sync (or click Sync Installations on the dashboard):
  - Verify that `test-prpilot-sandbox` appears in your repository list with default settings (`balanced` strictness).
- [ ] **[YOU]** In `test-prpilot-sandbox`, create a new branch and open a Pull Request with a small code change containing an intentional issue (e.g. unhandled null pointer or SQL concatenation).
- [ ] **[YOU]** Verify the review pipeline:
  - Check GitHub App webhook deliveries in GitHub App Settings > **Advanced** to confirm the `pull_request.opened` event delivered with status 200.
  - Within 15–45 seconds, verify that PRPilot posts a top-level review summary comment with a calculated risk score, severity breakdown, and fenced suggestions.
- [ ] **[YOU]** Push a second commit to the same PR branch (`synchronize` event) and verify that the existing review comment is updated in-place rather than posting a duplicate comment.
