-- Migration: Atomic queue claim for review jobs and expanded statuses
-- Task 10: Cron fallback processor

-- 1. Expand review_jobs status constraint to include 'queued' and 'failed'
ALTER TABLE public.review_jobs
  DROP CONSTRAINT IF EXISTS review_jobs_status_check;

ALTER TABLE public.review_jobs
  ADD CONSTRAINT review_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'error', 'failed', 'skipped', 'deferred', 'partial', 'queued'));

-- 2. Partial index for fast queue candidate lookups
CREATE INDEX IF NOT EXISTS idx_review_jobs_runnable
  ON public.review_jobs(status, created_at)
  WHERE status IN ('pending', 'processing', 'deferred', 'queued');

-- 3. Atomic claim function using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_review_jobs(
  claim_limit INT DEFAULT 3,
  stale_seconds INT DEFAULT 180,
  include_deferred BOOLEAN DEFAULT false,
  max_retries INT DEFAULT 5
)
RETURNS SETOF public.review_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Mark any jobs that exceeded max_retries as failed
  UPDATE public.review_jobs
  SET
    status = 'failed',
    error_message = COALESCE(error_message, 'Max retries reached'),
    completed_at = now()
  WHERE status IN ('pending', 'processing', 'deferred', 'queued')
    AND retry_count >= max_retries;

  -- Atomically claim runnable jobs with FOR UPDATE SKIP LOCKED
  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT id, status AS current_status
    FROM public.review_jobs
    WHERE (
      status IN ('pending', 'queued')
      OR (status = 'deferred' AND include_deferred IS TRUE)
      OR (status = 'processing' AND (started_at IS NULL OR started_at < now() - (stale_seconds || ' seconds')::interval))
    )
    AND retry_count < max_retries
    ORDER BY created_at ASC
    LIMIT claim_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.review_jobs j
  SET
    status = 'processing',
    started_at = now(),
    retry_count = CASE
      WHEN c.current_status = 'processing' THEN j.retry_count + 1
      ELSE j.retry_count
    END
  FROM candidate_jobs c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

-- 4. Permissions: service role only
REVOKE EXECUTE ON FUNCTION public.claim_review_jobs(INT, INT, BOOLEAN, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_review_jobs(INT, INT, BOOLEAN, INT) TO service_role;
