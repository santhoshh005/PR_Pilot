# PRPilot — API Reference

All routes use Next.js App Router Route Handlers (`app/api/.../route.ts`).

## Authentication

Dashboard endpoints require a valid Supabase session cookie. The Supabase client in middleware validates the session and attaches `user.id` to the request context.

Server-side routes (webhook, cron) use the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS.

---

## 1. Webhook

### `POST /api/webhook`

Receives GitHub App webhook events. Only `pull_request` events with actions `opened`, `synchronize`, and `reopened` are processed; all others return 200 with `{ "ignored": true }`.

**Headers (from GitHub):**

| Header | Required | Description |
|---|---|---|
| `x-hub-signature-256` | Yes | HMAC-SHA256 of the body using the webhook secret |
| `x-github-delivery` | Yes | Unique delivery UUID for idempotency |
| `x-github-event` | Yes | Event name (e.g., `pull_request`) |

**Request body:** GitHub webhook JSON payload (validated with `WebhookPullRequestSchema`).

**Responses:**

| Status | Body | When |
|---|---|---|
| `200` | `{ "ok": true, "job_id": "<uuid>" }` | Job enqueued successfully |
| `200` | `{ "ignored": true }` | Event/action not handled |
| `200` | `{ "duplicate": true }` | Delivery ID already processed |
| `401` | `{ "error": "unauthorized", "message": "Invalid signature", "status": 401 }` | Signature verification failed |
| `400` | `{ "error": "bad_request", "message": "<detail>", "status": 400 }` | Missing headers or invalid payload |
| `500` | `{ "error": "internal", "message": "...", "status": 500 }` | Server error |

---

## 2. Cron — Process Reviews

### `POST /api/cron/process-reviews`

Called by Vercel Cron every 2 minutes as a fallback for reviews not completed by `waitUntil`. Picks stale `processing` or missed `pending` jobs.

**Headers:**

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | `Bearer <CRON_SECRET>` — must match `CRON_SECRET` env var |

**Request body:** None.

**Responses:**

| Status | Body | When |
|---|---|---|
| `200` | `{ "processed": N, "jobs": ["<id>", ...] }` | Successfully processed N chunks |
| `200` | `{ "processed": 0 }` | No pending work |
| `401` | `{ "error": "unauthorized", ... }` | Invalid or missing CRON_SECRET |
| `500` | `{ "error": "internal", ... }` | Processing error (partial work saved) |

**Vercel Cron config** (`vercel.json`):
```json
{
  "crons": [
    {
      "path": "/api/cron/process-reviews",
      "schedule": "*/2 * * * *"
    }
  ]
}
```

---

## 3. Auth

### `GET /api/auth/callback`

Supabase OAuth callback. Exchanges the authorization code for a session.

**Query params:**

| Param | Description |
|---|---|
| `code` | OAuth authorization code from Supabase |
| `next` | Optional redirect URL (defaults to `/dashboard`) |

**Responses:**

| Status | Action |
|---|---|
| `303` | Redirect to `next` URL with session cookie set |
| `303` | Redirect to `/auth/error` on failure |

### `POST /api/auth/signout`

Destroys the Supabase session.

**Responses:**

| Status | Body |
|---|---|
| `200` | `{ "ok": true }` |

---

## 4. Dashboard Data Endpoints

All dashboard endpoints require authentication (Supabase session cookie). Unauthorized requests get `401`.

### `GET /api/repos`

Returns repos belonging to the authenticated user's installations.

**Response `200`:**
```typescript
{
  repos: DashboardRepo[]
}
```

**`DashboardRepo` shape:**
```typescript
{
  id: string;
  full_name: string;
  owner: string;
  name: string;
  is_active: boolean;
  total_reviews: number;
  avg_risk_score: number | null;
  last_review_at: string | null;
}
```

---

### `GET /api/repos/[repoId]/reviews`

Returns review history for a specific repo.

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 20 | Items per page (max 50) |

**Response `200`:**
```typescript
{
  reviews: ReviewHistoryItem[];
  total: number;
  page: number;
  limit: number;
}
```

**Errors:**

| Status | When |
|---|---|
| `404` | Repo not found or not owned by user |
| `400` | Invalid query params |

---

### `GET /api/repos/[repoId]/reviews/[reviewId]`

Returns a single review with its inline comments.

**Response `200`:**
```typescript
{
  review: Review;
  comments: ReviewComment[];
}
```

---

### `GET /api/repos/[repoId]/stats`

Returns aggregated statistics for charts.

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `days` | number | 30 | Lookback period in days (max 90) |

**Response `200`:**
```typescript
{
  severity_breakdown: SeverityBreakdown[];
  risk_trend: RiskScoreTrend[];
  total_reviews: number;
  avg_review_duration_ms: number;
}
```

---

### `GET /api/repos/[repoId]/settings`

Returns per-repo settings.

**Response `200`:**
```typescript
{
  settings: RepoSettings;
}
```

---

### `PATCH /api/repos/[repoId]/settings`

Updates per-repo settings. Partial updates allowed.

**Request body** (validated with `RepoSettingsUpdateSchema`):
```typescript
{
  ignored_paths?: string[];
  strictness?: "relaxed" | "balanced" | "strict";
  custom_instructions?: string;
}
```

**Responses:**

| Status | Body |
|---|---|
| `200` | `{ "settings": RepoSettings }` |
| `400` | Validation error with Zod issues |
| `404` | Repo not found |

---

## 5. Installation Sync

### `POST /api/installations/sync`

Fetches the authenticated user's GitHub App installations and syncs repos to the database. Called after initial login or manually from the dashboard.

**Response `200`:**
```typescript
{
  installations: number;  // count synced
  repos: number;          // count synced
}
```

---

## Error Format

All errors follow the `ApiError` shape:

```typescript
{
  error: string;     // machine-readable code: "unauthorized", "bad_request", "not_found", "internal"
  message: string;   // human-readable detail
  status: number;    // HTTP status code
}
```

---

## Rate Limiting

A simple in-memory rate limiter (Map-based, per IP) protects all API endpoints:
- **Webhook**: 60 requests/minute per IP
- **Dashboard endpoints**: 30 requests/minute per user
- **Auth**: 10 requests/minute per IP

Returns `429` with `{ "error": "rate_limited", "message": "Too many requests", "status": 429 }`.
