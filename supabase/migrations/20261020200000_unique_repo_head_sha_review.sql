-- Migration: Unique constraint on (repo_id, head_sha) in reviews table
-- Prevents duplicate review rows across webhook redeliveries

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_repo_head_sha
  ON public.reviews(repo_id, head_sha);
