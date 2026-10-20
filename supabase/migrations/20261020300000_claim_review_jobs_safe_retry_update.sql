-- Migration: Restrict max-retry UPDATE in claim_review_jobs
-- Ensures jobs already failed are not touched, preventing unnecessary lock contention

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
  -- Mark any jobs that exceeded max_retries as failed (excluding already failed jobs)
  UPDATE public.review_jobs
  SET
    status = 'failed',
    error_message = COALESCE(error_message, 'Max retries reached'),
    completed_at = now()
  WHERE status IN ('pending', 'processing', 'deferred', 'queued')
    AND status != 'failed'
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

REVOKE EXECUTE ON FUNCTION public.claim_review_jobs(INT, INT, BOOLEAN, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_review_jobs(INT, INT, BOOLEAN, INT) TO service_role;
