-- PRPilot Database Schema
-- Supabase Postgres with RLS
-- Run via Supabase Dashboard SQL Editor or migration

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Tables
-- ============================================================

-- Users: extends Supabase auth.users with GitHub-specific data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_user_id BIGINT NOT NULL UNIQUE,
  github_username TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GitHub App installations linked to users
CREATE TABLE public.installations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  installation_id BIGINT NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_login TEXT NOT NULL,       -- GitHub org or user login
  account_type TEXT NOT NULL CHECK (account_type IN ('User', 'Organization')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at TIMESTAMPTZ
);

-- Repos tracked by the app
CREATE TABLE public.repos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  installation_id UUID NOT NULL REFERENCES public.installations(id) ON DELETE CASCADE,
  github_repo_id BIGINT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,           -- "owner/name"
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-repo review settings
CREATE TABLE public.repo_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL UNIQUE REFERENCES public.repos(id) ON DELETE CASCADE,
  ignored_paths TEXT[] NOT NULL DEFAULT '{}',
  strictness TEXT NOT NULL DEFAULT 'balanced' CHECK (strictness IN ('relaxed', 'balanced', 'strict')),
  custom_instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook delivery idempotency log
CREATE TABLE public.webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,      -- X-GitHub-Delivery header
  event TEXT NOT NULL,               -- e.g. "pull_request"
  action TEXT NOT NULL,              -- e.g. "opened", "synchronize"
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Review job queue
CREATE TABLE public.review_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  pr_title TEXT NOT NULL,
  pr_author TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES public.webhook_deliveries(delivery_id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'error', 'skipped')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  total_chunks INTEGER,
  completed_chunks INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual chunk review results
CREATE TABLE public.review_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES public.review_jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  diff_content TEXT NOT NULL,
  review_json JSONB,                 -- raw AI response (matches ChunkReviewResult schema)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, chunk_index)
);

-- Final assembled review (one per completed job)
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL UNIQUE REFERENCES public.review_jobs(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  pr_title TEXT NOT NULL,
  pr_author TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  summary TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  severity_counts JSONB NOT NULL,    -- { "critical": N, "warning": N, "suggestion": N, "praise": N }
  inline_comment_count INTEGER NOT NULL DEFAULT 0,
  review_duration_ms INTEGER NOT NULL DEFAULT 0,
  github_review_id BIGINT,          -- ID of the posted GitHub review
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inline comments within a review
CREATE TABLE public.review_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  line_number INTEGER,
  side TEXT NOT NULL DEFAULT 'RIGHT' CHECK (side IN ('LEFT', 'RIGHT')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'suggestion', 'praise')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  suggestion TEXT,                    -- suggested replacement code
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_installations_owner ON public.installations(owner_id);
CREATE INDEX idx_repos_installation ON public.repos(installation_id);
CREATE INDEX idx_repos_full_name ON public.repos(full_name);
CREATE INDEX idx_review_jobs_status ON public.review_jobs(status) WHERE status IN ('pending', 'processing');
CREATE INDEX idx_review_jobs_repo ON public.review_jobs(repo_id);
CREATE INDEX idx_review_jobs_created ON public.review_jobs(created_at DESC);
CREATE INDEX idx_review_chunks_job ON public.review_chunks(job_id);
CREATE INDEX idx_reviews_repo ON public.reviews(repo_id);
CREATE INDEX idx_reviews_created ON public.reviews(created_at DESC);
CREATE INDEX idx_review_comments_review ON public.review_comments(review_id);
CREATE INDEX idx_webhook_deliveries_received ON public.webhook_deliveries(received_at);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repo_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update only their own profile
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (select auth.uid()));

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()));

-- Installations: users can see their own installations
CREATE POLICY installations_select ON public.installations
  FOR SELECT TO authenticated
  USING (owner_id = (select auth.uid()));

-- Repos: users can see repos under their installations
CREATE POLICY repos_select ON public.repos
  FOR SELECT TO authenticated
  USING (
    installation_id IN (
      SELECT i.id FROM public.installations i WHERE i.owner_id = (select auth.uid())
    )
  );

-- Repo settings: users can read/update settings for their repos
CREATE POLICY repo_settings_select ON public.repo_settings
  FOR SELECT TO authenticated
  USING (
    repo_id IN (
      SELECT r.id FROM public.repos r
      JOIN public.installations i ON r.installation_id = i.id
      WHERE i.owner_id = (select auth.uid())
    )
  );

CREATE POLICY repo_settings_update ON public.repo_settings
  FOR UPDATE TO authenticated
  USING (
    repo_id IN (
      SELECT r.id FROM public.repos r
      JOIN public.installations i ON r.installation_id = i.id
      WHERE i.owner_id = (select auth.uid())
    )
  );

-- Webhook deliveries: no user access (service role only)
-- No SELECT/INSERT/UPDATE/DELETE policies → blocked for anon/authenticated

-- Review jobs: users can see jobs for their repos
CREATE POLICY review_jobs_select ON public.review_jobs
  FOR SELECT TO authenticated
  USING (
    repo_id IN (
      SELECT r.id FROM public.repos r
      JOIN public.installations i ON r.installation_id = i.id
      WHERE i.owner_id = (select auth.uid())
    )
  );

-- Review chunks: users can see chunks for their repos' jobs
CREATE POLICY review_chunks_select ON public.review_chunks
  FOR SELECT TO authenticated
  USING (
    job_id IN (
      SELECT rj.id FROM public.review_jobs rj
      JOIN public.repos r ON rj.repo_id = r.id
      JOIN public.installations i ON r.installation_id = i.id
      WHERE i.owner_id = (select auth.uid())
    )
  );

-- Reviews: users can see reviews for their repos
CREATE POLICY reviews_select ON public.reviews
  FOR SELECT TO authenticated
  USING (
    repo_id IN (
      SELECT r.id FROM public.repos r
      JOIN public.installations i ON r.installation_id = i.id
      WHERE i.owner_id = (select auth.uid())
    )
  );

-- Review comments: users can see comments on their reviews
CREATE POLICY review_comments_select ON public.review_comments
  FOR SELECT TO authenticated
  USING (
    review_id IN (
      SELECT rv.id FROM public.reviews rv
      JOIN public.repos r ON rv.repo_id = r.id
      JOIN public.installations i ON r.installation_id = i.id
      WHERE i.owner_id = (select auth.uid())
    )
  );

-- ============================================================
-- Service role bypass note:
-- All INSERT/UPDATE/DELETE from the webhook handler and cron
-- processor use the Supabase service_role key, which bypasses
-- RLS. This is intentional: those operations are server-side
-- only and don't have a user context.
-- ============================================================

-- ============================================================
-- Helper function: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_repos_updated_at
  BEFORE UPDATE ON public.repos
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_repo_settings_updated_at
  BEFORE UPDATE ON public.repo_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- Cleanup: expire old webhook deliveries after 7 days
-- (run via pg_cron or app-level cron)
-- ============================================================
-- DELETE FROM public.webhook_deliveries WHERE received_at < now() - interval '7 days';
