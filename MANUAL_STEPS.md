# PRPilot — Manual Setup & Deployment Checklist

This document details all configuration, provisioning, and deployment steps required to run PRPilot in production. Steps requiring personal account login, private credentials, or administrative privileges are marked **`[YOU]`**. Steps handled by the assistant or automated build pipelines are marked **`[AGENT]`**.

---

## 1. Authentication Architecture & Callback URLs

Understanding the OAuth flow is essential to configuring callback URLs correctly:

```
[User Browser]
      │
      │ 1. Clicks "Continue with GitHub" on https://<your-app>.vercel.app/login
      ▼
[Supabase Auth Server] (https://<project-ref>.supabase.co/auth/v1/authorize)
      │
      │ 2. Redirects browser to GitHub OAuth authorization with redirect_uri:
      │    https://<project-ref>.supabase.co/auth/v1/callback
      ▼
[GitHub OAuth]
      │
      │ 3. User approves access. GitHub redirects browser back to:
      │    https://<project-ref>.supabase.co/auth/v1/callback?code=<github-code>
      ▼
[Supabase Auth Server]
      │
      │ 4. Exchanges <github-code> for GitHub user token, creates/finds user,
      │    and redirects browser to configured redirectTo destination:
      │    https://<your-app>.vercel.app/api/auth/callback?code=<supabase-code>
      ▼
[PRPilot App / Next.js Server]
      │
      │ 5. /api/auth/callback exchanges <supabase-code> for Supabase session,
      │    syncs profile identity, and redirects user to /dashboard.
      ▼
[PRPilot Dashboard]
```

### Critical Distinction Between Callback URLs
1. **GitHub App / OAuth App "Authorization Callback URL"**:
   - **Must be**: `https://<project-ref>.supabase.co/auth/v1/callback` (for project `ajsvejrikxaqztbnctwj`: `https://ajsvejrikxaqztbnctwj.supabase.co/auth/v1/callback`).
   - GitHub sends the OAuth authorization code to **Supabase**, not directly to your Next.js app.
   - Setting this to `https://<your-app>.vercel.app/api/auth/callback` in GitHub will cause GitHub to reject sign-ins with `redirect_uri_mismatch`.
2. **Supabase "Redirect URLs" Allow-List**:
   - **Must be**: `http://localhost:3000/**` and `https://<your-app>.vercel.app/**`.
   - This tells Supabase that your Next.js application at `https://<your-app>.vercel.app/api/auth/callback` is an authorized destination for Supabase Auth session completion.

---

## 2. GitHub App Registration Field-by-Field

Navigate to GitHub: **Settings > Developer Settings > GitHub Apps > New GitHub App** (or your personal account's developer settings).

| Setting / Field | Exact Value / Guidance | Reason | Marked |
|---|---|---|---|
| **GitHub App name** | `prpilot-<your-unique-suffix>` (e.g. `prpilot-santhosh`) | Must be globally unique on GitHub. | **`[YOU]`** |
| **Homepage URL** | `https://<your-app>.vercel.app` (or temporary repo URL) | Shown on GitHub App listing. | **`[YOU]`** |
| **Callback URL** | `https://<your-project-ref>.supabase.co/auth/v1/callback` (for project `ajsvejrikxaqztbnctwj`: `https://ajsvejrikxaqztbnctwj.supabase.co/auth/v1/callback`) | Supabase Auth server OAuth receiver. **Do not** enter `/api/auth/callback` here! | **`[YOU]`** |
| **Request user authorization (OAuth) during installation** | Checked | Allows user login and generates Client ID & Secret for Supabase Auth. | **`[YOU]`** |
| **Setup URL (Redirect after installation)** | `https://<your-app>.vercel.app/dashboard` | Redirects user to dashboard after installing app on repositories. | **`[YOU]`** |
| **Redirect on update** | Unchecked | Unnecessary for normal operations. | **`[YOU]`** |
| **Webhook Active** | Checked | Required to receive real-time repository pull request events. | **`[YOU]`** |
| **Webhook URL** | `https://<your-app>.vercel.app/api/webhook` | Application webhook endpoint. | **`[YOU]`** |
| **Webhook secret** | Generated string via `openssl rand -hex 32` | Matches `GITHUB_WEBHOOK_SECRET` for HMAC-SHA256 signature verification. | **`[YOU]`** |
| **Repository permissions: Pull requests** | `Read and write` | Pull requests to read PR metadata and post reviews. | **`[YOU]`** |
| **Repository permissions: Contents** | `Read-only` | Contents read-only because GitHub requires it to return a pull request's diff (read-only: the app cannot change code). | **`[YOU]`** |
| **Repository permissions: Metadata** | `Read-only` | Metadata is mandatory. | **`[YOU]`** |
| **All other permissions** | `No access` | Least-privilege principle: Issues, Actions, Administration, etc., are never requested. | **`[YOU]`** |
| **Subscribe to events** | `Pull request` only | Listens to `opened`, `synchronize`, `reopened`. | **`[YOU]`** |
| **Where can this GitHub App be installed?** | `Only on this account` | Required: PRPilot v1 enforces personal-account ownership (`User`). | **`[YOU]`** |

> [!IMPORTANT]
> **Accepting Updated Permissions**: If you edit permissions on an existing GitHub App (such as adding `Contents: Read-only`), GitHub does not automatically apply them to active installations. The installation owner must accept the updated permissions at `github.com/settings/installations` (or organization installation settings) by clicking **Configure** next to PRPilot and then **Review & accept updated permissions**. Otherwise, GitHub API requests will continue to fail with HTTP 403 `Resource not accessible by integration`.

After clicking **Create GitHub App**:
1. Note the numeric **App ID** at the top of the General settings page (`GITHUB_APP_ID`).
2. In the **Client secrets** section, click **Generate a new client secret**. Copy the **Client ID** and **Client Secret** (used in Supabase Auth provider settings).
3. In the **Private keys** section, click **Generate a private key**. A `.pem` file downloads (`GITHUB_PRIVATE_KEY`). Keep this file secure and outside any git repository.

---

## 3. Environment Variables & Build-Time vs. Runtime Behavior

### Variable Classification Table

| Environment Variable | Build-Time vs. Runtime | Secret? | Format / Handling | Marked |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Build-Time** (inlined into JS bundle) | No | `https://<project-ref>.supabase.co` | **`[YOU]`** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Build-Time** (inlined into JS bundle) | No | Supabase anon public key | **`[YOU]`** |
| `NEXT_PUBLIC_APP_URL` | **Build-Time** (inlined into JS bundle) | No | `https://<your-app>.vercel.app` (no trailing slash) | **`[YOU]`** |
| `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL` | **Build-Time** (inlined into JS bundle) | No | `https://github.com/apps/<app-slug>/installations/new` | **`[YOU]`** |
| `GITHUB_APP_ID` | **Runtime-Only** (Serverless functions) | No | Numeric ID (e.g. `123456`) | **`[YOU]`** |
| `GITHUB_PRIVATE_KEY_BASE64` | **Runtime-Only** (Serverless functions) | **Yes** | **Recommended**: Base64 of whole `.pem` file; pastes cleanly into Vercel without newline loss | **`[YOU]`** |
| `GITHUB_PRIVATE_KEY` | **Runtime-Only** (Serverless functions) | **Yes** | Supported alternative: Multiline PEM or escaped single-line `\n` | **`[YOU]`** |
| `GITHUB_WEBHOOK_SECRET` | **Runtime-Only** (Serverless functions) | **Yes** | 32-byte hex string from `openssl rand -hex 32` | **`[YOU]`** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Runtime-Only** (Serverless functions) | **Yes** | Supabase service-role secret key (bypasses RLS on server) | **`[YOU]`** |
| `GEMINI_API_KEY` | **Runtime-Only** (Serverless functions) | **Yes** | Google AI Studio API key | **`[YOU]`** |
| `CRON_SECRET` | **Runtime-Only** (Serverless functions) | **Yes** | 32-byte hex string from `openssl rand -hex 32` | **`[YOU]`** |
| `GEMINI_MODEL` | **Runtime-Only** (Serverless functions) | No | Default: `gemini-3.8-flash` (or `gemini-2.5-flash`) | **`[YOU]`** |
| `GEMINI_FALLBACK_MODEL` | **Runtime-Only** (Serverless functions) | No | Optional backup model ID on 503 (e.g. `gemini-3.5-flash-lite`, Config type in Vercel) | **`[YOU]`** |
| `GEMINI_DAILY_LIMIT` | **Runtime-Only** (Serverless functions) | No | Daily request cap (e.g. `15` for free tier, `1500` for standard) | **`[YOU]`** |
| `GEMINI_CONCURRENCY` | **Runtime-Only** (Serverless functions) | No | Max concurrent chunk LLM calls (default: `2`) | **`[YOU]`** |
| `GEMINI_THINKING_LEVEL` | **Runtime-Only** (Serverless functions) | No | Supported: `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` (default: `LOW`) | **`[YOU]`** |
| `GEMINI_MAX_OUTPUT_TOKENS` | **Runtime-Only** (Serverless functions) | No | Integer between 1024 and 65536 (default: `4096`) | **`[YOU]`** |

### Build Tolerance & Secrets
- **Build Tolerance**: Next.js (`pnpm build`) compiles cleanly **even if GitHub credentials (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`) are not yet set**. Octokit client initialization is strictly lazy inside request handlers (`getAppOctokit`, `getInstallationOctokit`), and all API routes and dashboard pages are dynamically evaluated at request time.
- **Client Bundle Inlining**: Next.js inlines all `NEXT_PUBLIC_*` variables into the static JavaScript chunks during the build step. If `NEXT_PUBLIC_APP_URL` or `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL` is added or changed in Vercel Project Settings, **you must trigger a Redeploy** for the browser to receive the updated value.
- **Private Key Format Handling**: In `src/lib/github/app.ts`, private key loading supports multiple robust formats:
  1. **`GITHUB_PRIVATE_KEY_BASE64` (RECOMMENDED)**: Base64-encoded string of the entire `.pem` file. This is the most reliable approach for Vercel's web UI because base64 strings contain no internal line breaks, quotation ambiguities, or multi-line pasting issues. Copy directly to clipboard on Windows (PowerShell):
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\key.pem")) | Set-Clipboard
     ```
  2. **`GITHUB_PRIVATE_KEY`**: Standard multiline PEM string, or single-line string with literal `\n` or space-collapsed lines (wrapped in quotes or unquoted).
  3. **Automatic Normalisation & Conversion**: `loadPrivateKey()` strips wrapping quotes, normalises literal `\n`, re-chunks collapsed base64 payloads to 64 characters per line between headers, validates that the key is an RSA key using Node's `node:crypto`, and re-exports it as canonical PKCS#8 PEM so that `@octokit/auth-app` and Web Crypto DER parsing sign JWTs without ASN.1 tag errors.

---

## 4. Chicken-and-Egg Free Deployment Sequence

Follow this exact sequence to deploy without circular URL or credential dependencies:

### Step 1: Push Code to GitHub
- [ ] **`[AGENT]`** Verify tests, lint, and type-checks pass. Push clean `main` branch to GitHub repository `santhoshh005/PR_Pilot`.

### Step 2: Create Vercel Project & Claim Domain
- [ ] **`[YOU]`** Log in to [Vercel](https://vercel.com) and click **Add New > Project**.
- [ ] **`[YOU]`** Import `PR_Pilot` from GitHub.
- [ ] **`[YOU]`** Set project name (e.g. `prpilot-santhosh`) to establish your canonical production domain: `https://<your-project>.vercel.app`.
- [ ] **`[YOU]`** Under **Environment Variables**, add the known values:
  - `NEXT_PUBLIC_SUPABASE_URL`: `https://ajsvejrikxaqztbnctwj.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `<your-supabase-anon-key>`
  - `NEXT_PUBLIC_APP_URL`: `https://<your-project>.vercel.app`
  - `SUPABASE_SERVICE_ROLE_KEY`: `<your-supabase-service-role-key>`
  - `GEMINI_API_KEY`: `<your-gemini-api-key>`
  - `CRON_SECRET`: `<generated-32-byte-hex-secret>`
  *(Leave GitHub variables unset for now; the initial build does not require them)*.
- [ ] **`[YOU]`** Click **Deploy**. The build will succeed and confirm your live production domain.

### Step 3: Configure Supabase Auth URL Configuration
- [ ] **`[YOU]`** Open [Supabase Dashboard](https://supabase.com/dashboard/project/ajsvejrikxaqztbnctwj) > **Authentication > URL Configuration**.
- [ ] **`[YOU]`** Set **Site URL** to `https://<your-project>.vercel.app`.
- [ ] **`[YOU]`** Under **Redirect URLs**, add:
  - `http://localhost:3000/**`
  - `https://<your-project>.vercel.app/**`
- [ ] **`[YOU]`** Click **Save**.

### Step 4: Register the GitHub App
- [ ] **`[YOU]`** Go to GitHub: **Settings > Developer Settings > GitHub Apps > New GitHub App**.
- [ ] **`[YOU]`** Fill in the fields from Section 2 above using your live Vercel domain:
  - Homepage URL: `https://<your-project>.vercel.app`
  - Callback URL: `https://<your-project-ref>.supabase.co/auth/v1/callback` (for project `ajsvejrikxaqztbnctwj`: `https://ajsvejrikxaqztbnctwj.supabase.co/auth/v1/callback`)
  - Setup URL: `https://<your-project>.vercel.app/dashboard`
  - Webhook URL: `https://<your-project>.vercel.app/api/webhook`
  - Webhook secret: Paste generated 32-byte secret (`GITHUB_WEBHOOK_SECRET`)
  - Permissions: Pull requests (Read & write), Contents (Read-only), Metadata (Read-only); all others No access
  - Events: Pull request
  - Install target: Only on this account
- [ ] **`[YOU]`** Click **Create GitHub App**.
- [ ] **`[YOU]`** Copy the numeric **App ID**.
- [ ] **`[YOU]`** Generate a new **Client secret**; copy **Client ID** and **Client Secret**.
- [ ] **`[YOU]`** Generate a **Private key** and download the `.pem` file.

### Step 5: Enable GitHub Provider in Supabase Auth
- [ ] **`[YOU]`** In Supabase Dashboard, go to **Authentication > Providers > GitHub**.
- [ ] **`[YOU]`** Toggle **Enable GitHub** to `ON`.
- [ ] **`[YOU]`** Paste the **Client ID** and **Client Secret** obtained in Step 4.
- [ ] **`[YOU]`** Verify the displayed callback URL matches `https://<your-project-ref>.supabase.co/auth/v1/callback` (for project `ajsvejrikxaqztbnctwj`: `https://ajsvejrikxaqztbnctwj.supabase.co/auth/v1/callback`). Click **Save**.

### Step 6: Add GitHub Credentials to Vercel & Redeploy
- [ ] **`[YOU]`** In Vercel > **Project Settings > Environment Variables**, add:
  - `GITHUB_APP_ID`: `<numeric-app-id>`
  - `GITHUB_PRIVATE_KEY_BASE64`: **(Recommended)** Base64 of the `.pem` file copied via PowerShell (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\key.pem")) | Set-Clipboard`)
  - *(Alternatively, `GITHUB_PRIVATE_KEY` with raw PEM contents is also supported)*
  - `GITHUB_WEBHOOK_SECRET`: `<webhook-secret>`
  - `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL`: `https://github.com/apps/<app-slug>/installations/new`
- [ ] **`[YOU]`** Go to Vercel > **Deployments**, click the three dots on your latest deployment, and click **Redeploy** (with build cache cleared if needed) so `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL` is inlined into the frontend bundle.

### Step 7: Configure Vercel Deployment Protection Bypass
- [ ] **`[YOU]`** In Vercel > **Project Settings > Deployment Protection**:
  - For **Production**: Ensure Vercel Authentication is **Disabled** (or set to standard public access).
  - *Why this matters*: If Vercel Authentication is enabled on Production, incoming webhook POST requests from GitHub and cron POST requests from GitHub Actions will be blocked with `401 Unauthorized` or redirected to a Vercel SSO login page (`307`), preventing PRPilot from receiving webhooks or running cron jobs.
  - If Deployment Protection is strictly required by your organization, configure a **Protection Bypass for Automation** secret and pass `x-vercel-protection-bypass: <secret>` in cron workflows, or add route exclusions for `/api/webhook` and `/api/cron/process-reviews`.

### Step 8: Configure GitHub Actions Cron Workflow
- [ ] **`[YOU]`** In your GitHub repository (`PR_Pilot`), go to **Settings > Secrets and variables > Actions**:
  - Under **Repository secrets**, add:
    - Name: `CRON_SECRET`
    - Value: Paste the identical `CRON_SECRET` value from Vercel.
  - Under **Repository variables**, add:
    - Name: `APP_URL`
    - Value: `https://<your-project>.vercel.app` (no trailing slash).
- [ ] **`[AGENT]`** Confirmed `.github/workflows/cron.yml` runs on `*/30 * * * *` without external action dependencies and skips cleanly if `APP_URL` is unset.

### Step 9: Install GitHub App & Verify End-to-End
- [ ] **`[YOU]`** In GitHub App Settings > **Install App**, click **Install** next to your personal account.
- [ ] **`[YOU]`** Choose `Only select repositories` and pick a test repository.
- [ ] **`[YOU]`** **Accept Updated Permissions (if modifying an existing installation)**: After editing permissions on the GitHub App, the installation owner must accept the updated permissions at `github.com/settings/installations` (click **Configure** next to PRPilot and approve the prompt), otherwise requests will continue to fail with 403.
- [ ] **`[YOU]`** Open your live deployment: `https://<your-project>.vercel.app/login`.
- [ ] **`[YOU]`** Click **Continue with GitHub**; authenticate and confirm redirection to `/dashboard`.
- [ ] **`[YOU]`** Click **Sync Repositories** in the dashboard header or empty state.
- [ ] **`[YOU]`** Confirm the installed repository appears with its toggle set to Active.
- [ ] **`[YOU]`** Open a small test Pull Request in the repository. Verify:
  - GitHub App Settings > **Advanced > Recent Deliveries** shows a `pull_request.opened` event delivered with status `200`.
  - Within 15–45 seconds, PRPilot posts an AI review summary with risk score, markdown diff suggestions, and file analysis.

---

## 5. Security Audit of Public Unauthenticated Endpoints

Every unauthenticated HTTP request from a stranger is handled strictly as follows:

| Route | HTTP Methods | Unauthenticated Stranger Response | Information Leakage Check |
|---|---|---|---|
| `/` | `GET` | `200 OK` (Public landing page) | None. Marketing copy only. |
| `/login` | `GET` | `200 OK` (Public login page) | None. Renders GitHub OAuth button. |
| `/error` | `GET` | `200 OK` (Public error page) | None. Generic error descriptions only. |
| `/_not-found` | `GET` | `404 Not Found` (Standard 404 page) | None. |
| `/dashboard` & sub-routes | `GET` | `307 Temporary Redirect` to `/login` | None. Server component checks session; no user data sent. |
| `/api/auth/callback` | `GET` | `307 Redirect` to `/error?error=missing_code` | None. Rejects requests without valid code. |
| `/api/auth/signout` | `GET` / `POST` | `GET`: `405 Method Not Allowed`. Cross-origin `POST`: `403 Forbidden`. | None. CSRF origin check enforced. |
| `/api/webhook` | `POST` | `401 Unauthorized` (`{"error":"unauthorized","message":"Invalid signature","status":401}`) | None. Timing-safe HMAC verification rejects invalid or missing signatures. |
| `/api/cron/process-reviews` | `POST` | `401 Unauthorized` (`{"error":"unauthorized"}`) | None. Timing-safe Bearer token check rejects unauthorized callers. |
| `/api/installations/sync` | `POST` | `401 Unauthorized` (`{"error":"unauthorized","message":"Authentication required","status":401}`) | None. Requires valid Supabase auth cookie. |
| `/api/repos` | `GET` | `401 Unauthorized` (`{"error":"unauthorized","message":"Authentication required","status":401}`) | None. Requires valid Supabase auth cookie. |
| `/api/repos/[repoId]/*` | `GET`, `PATCH` | `401 Unauthorized` (`{"error":"unauthorized","message":"Authentication required","status":401}`) | None. Requires valid Supabase auth cookie. |
| **Debug / Health Endpoints** | — | **None exist**. Zero `/health`, `/debug`, `/test`, or `/ping` endpoints exist in the codebase. | No debug routes present. |

> [!NOTE]
> For all single-method API routes (e.g., POST-only on `/api/webhook`, `/api/cron/process-reviews`, and `/api/installations/sync`, or GET-only on `/api/repos`), requests using unhandled HTTP methods safely receive Next.js standard `405 Method Not Allowed` responses with zero internal details or stack traces exposed.
