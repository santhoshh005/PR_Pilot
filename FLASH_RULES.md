# PRPilot — Flash Model Rules

Hard rules for the weaker model (Gemini 3.8 Flash) implementing this project. Every task must follow these rules. Violations require rolling back and redoing the task.

---

## Folder Structure (Do Not Deviate)

```
src/
├── app/
│   ├── api/
│   │   ├── webhook/route.ts              # GitHub webhook handler
│   │   ├── cron/process-reviews/route.ts  # Cron fallback processor
│   │   ├── auth/
│   │   │   ├── callback/route.ts          # Supabase OAuth callback
│   │   │   └── signout/route.ts           # Sign out
│   │   ├── repos/route.ts                 # GET repos list
│   │   ├── repos/[repoId]/
│   │   │   ├── reviews/route.ts           # GET review history
│   │   │   ├── reviews/[reviewId]/route.ts# GET single review
│   │   │   ├── stats/route.ts             # GET stats for charts
│   │   │   └── settings/route.ts          # GET/PATCH repo settings
│   │   └── installations/sync/route.ts    # POST sync installations
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── error/page.tsx
│   ├── dashboard/
│   │   ├── page.tsx                       # Main dashboard (repos list)
│   │   └── [repoId]/
│   │       ├── page.tsx                   # Repo detail (reviews list)
│   │       ├── reviews/[reviewId]/page.tsx # Single review detail
│   │       └── settings/page.tsx          # Repo settings
│   ├── layout.tsx                         # Root layout
│   └── page.tsx                           # Landing page
├── components/
│   ├── ui/                                # Reusable primitives (Button, Card, etc.)
│   ├── dashboard/                         # Dashboard-specific components
│   │   ├── repo-card.tsx
│   │   ├── review-list.tsx
│   │   ├── severity-chart.tsx
│   │   ├── risk-trend-chart.tsx
│   │   └── review-detail.tsx
│   └── layout/                            # Header, sidebar, nav
│       ├── header.tsx
│       └── sidebar.tsx
├── lib/
│   ├── supabase/
│   │   ├── server.ts                      # createUserClient() — uses anon key + session
│   │   ├── service.ts                     # createServiceClient() — uses service role key
│   │   └── middleware.ts                  # Supabase session refresh for middleware
│   ├── github/
│   │   ├── app.ts                         # GitHub App instance (octokit)
│   │   ├── webhooks.ts                    # Webhook signature verification
│   │   └── diff-parser.ts                 # Parse unified diff → DiffChunk[]
│   ├── gemini/
│   │   ├── client.ts                      # Gemini API client setup
│   │   └── review.ts                      # Review generation (prompt + call + parse)
│   ├── review/
│   │   ├── processor.ts                   # Main review orchestrator
│   │   ├── merger.ts                      # Merge chunk results → FullReviewResult
│   │   └── poster.ts                      # Post review to GitHub
│   ├── rate-limit.ts                      # In-memory rate limiter
│   └── errors.ts                          # Centralized error helpers
├── types.ts                               # DO NOT MODIFY without asking
└── middleware.ts                          # Next.js middleware (session refresh + auth guard)
supabase/
└── schema.sql                             # DO NOT MODIFY without asking
```

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `diff-parser.ts` |
| React components | PascalCase file, PascalCase export | `RepoCard` in `repo-card.tsx` |
| Functions | camelCase | `processReview()` |
| Constants | UPPER_SNAKE_CASE | `MAX_CHUNK_TOKENS` |
| Types/Interfaces | PascalCase | `ReviewJob` |
| Zod schemas | PascalCase + "Schema" suffix | `ChunkReviewResultSchema` |
| API route files | always `route.ts` | `app/api/webhook/route.ts` |
| Test files | same name + `.test.ts` | `diff-parser.test.ts` |
| Environment variables | UPPER_SNAKE_CASE | `GITHUB_WEBHOOK_SECRET` |

---

## Error Handling Pattern

Every API route handler must follow this exact pattern:

```typescript
import { NextResponse } from "next/server";
import { ApiError } from "@/types";

export async function POST(request: Request) {
  try {
    // ... business logic ...
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (error) {
    console.error("[ROUTE_NAME]", error);
    const apiError: ApiError = {
      error: "internal",
      message: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
```

**Rules**:
1. Always wrap in try/catch.
2. Always log with a `[TAG]` prefix identifying the route.
3. Never expose stack traces in the response.
4. Use `NextResponse.json()` for all responses — never `new Response()`.
5. For validation errors, return 400 with the Zod error issues.

---

## Code Style Rules

1. **No `any` type.** Use `unknown` and narrow with type guards or Zod.
2. **No default exports** except for Next.js pages and layouts (where required).
3. **Import from `@/types`** for all shared types. Never redefine types locally.
4. **Import from `@/lib/*`** for utilities. Never put business logic in route handlers — extract to `lib/`.
5. **Prefer `async/await`** over `.then()` chains.
6. **Use `const` by default.** Only use `let` when reassignment is needed.
7. **No `console.log` in production code.** Use `console.error` for errors, `console.info` for operational logs.
8. **Max function length: 50 lines.** Extract helpers if longer.
9. **Early return pattern.** Check error conditions first, return early, keep the happy path unindented.

---

## Workflow Rules (Critical)

### One task at a time
- Only work on one task from PLAN.md at a time.
- Complete all tests and acceptance criteria before moving to the next task.
- If you get stuck, stop and ask rather than making architectural changes.

### Tests first
- For every task, write failing tests BEFORE writing implementation.
- Every function in `src/lib/` must have a corresponding `.test.ts` file.
- API routes must have integration tests using `vitest` with mocked dependencies.

### Do not modify shared files
- **NEVER modify `src/types.ts`** without explicit approval. If you think a type is wrong, stop and ask.
- **NEVER modify `supabase/schema.sql`** without explicit approval. If you need a schema change, stop and ask.
- **NEVER modify `ARCHITECTURE.md`, `SECURITY.md`, or `PROMPTS.md`** — these are architectural decisions already made.

### Git discipline
- Commit after each completed task with the message format: `task-NN: <goal from PLAN.md>`
- Do not commit failing tests.
- Do not commit `console.log` debugging statements.

### Import order
```typescript
// 1. Node/Next.js built-ins
import { NextResponse } from "next/server";
import crypto from "node:crypto";

// 2. External packages
import { z } from "zod";

// 3. Internal imports (path aliases)
import { ReviewJob, CONFIG } from "@/types";
import { createServiceClient } from "@/lib/supabase/service";
```

### Environment variable access
- Always access env vars through a validated config object or directly with `process.env.VAR_NAME!`.
- Never destructure `process.env` — it breaks tree-shaking and can leak at build time.
- Never use `NEXT_PUBLIC_` prefix for server-only secrets.

---

## Testing Rules

| Layer | Tool | What to Test |
|---|---|---|
| `lib/` functions | Vitest | Unit tests with mocked deps |
| API routes | Vitest | Integration tests with mocked Supabase/Octokit |
| UI components | Vitest + React Testing Library | Render + interaction tests |
| E2E flows | Playwright | Auth flow, dashboard navigation, webhook simulation |

### Test file location
- Unit tests: co-located next to source (`src/lib/github/diff-parser.test.ts`)
- E2E tests: `e2e/` directory at project root
- Test fixtures: `src/__fixtures__/` directory

### Mocking pattern
```typescript
import { vi, describe, it, expect } from "vitest";

// Mock at module level
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));
```

---

## What To Do When Stuck

1. **Type error you don't understand**: Check `src/types.ts` first. The type is probably already defined.
2. **Supabase query not returning data**: Check RLS policies. Remember: dashboard queries use `createUserClient()` (RLS enforced), server queries use `createServiceClient()` (RLS bypassed).
3. **Gemini API error**: Check if the response is valid JSON first, then Zod-parse it. The structured output schema should guarantee valid JSON.
4. **Test failing for no apparent reason**: Check if you're importing from the right path. Use `@/` alias, not relative paths.
5. **Anything else**: Stop, save your progress, and ask. Do not make architectural changes.

---

## Known Pitfalls

- Use request.text() (never request.json()) for webhook HMAC verification.
- In Next.js 15, params are async: always await context.params.
- Gemini structured output needs a hand-translated schema; verify it against the Zod schema with a test.
- Validate every AI-returned line number against the diff hunks before posting to GitHub.
- FOR UPDATE SKIP LOCKED must run through a Postgres function called with supabase.rpc.
- Supabase provider_token is only available at the auth callback; capture it there or use user_metadata.
- Wrap auth.uid() in (select auth.uid()) in every RLS policy.
- Treat all PR content as untrusted input.
