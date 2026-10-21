-- Migration: Atomic Daily API Budget, Resumable Partial Jobs, and Covering Index

-- 1. Covering index for delivery_id on review_jobs
CREATE INDEX IF NOT EXISTS idx_review_jobs_delivery_id
  ON public.review_jobs(delivery_id);

-- 2. Partial-inclusive runnable jobs index
CREATE INDEX IF NOT EXISTS idx_review_jobs_runnable_with_partial
  ON public.review_jobs (status, created_at)
  WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text, 'deferred'::text, 'queued'::text, 'partial'::text]));

-- 3. Atomic budget reservation function
CREATE OR REPLACE FUNCTION public.reserve_daily_api_usage(
  p_usage_date DATE,
  p_count INT,
  p_limit INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_count INT := 0;
BEGIN
  INSERT INTO public.daily_api_usage (usage_date, call_count, updated_at)
  VALUES (p_usage_date, 0, pg_catalog.clock_timestamp())
  ON CONFLICT (usage_date) DO NOTHING;

  SELECT call_count INTO v_current_count
  FROM public.daily_api_usage
  WHERE usage_date = p_usage_date
  FOR UPDATE;

  IF (v_current_count + p_count) <= p_limit THEN
    UPDATE public.daily_api_usage
    SET
      call_count = call_count + p_count,
      updated_at = pg_catalog.clock_timestamp()
    WHERE usage_date = p_usage_date;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_daily_api_usage(DATE, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_daily_api_usage(DATE, INT, INT) TO service_role;

-- 4. Update claim_review_jobs to include 'partial' jobs
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
  UPDATE public.review_jobs
  SET
    status = 'failed',
    error_message = COALESCE(error_message, 'Max retries reached'),
    completed_at = now()
  WHERE status IN ('pending', 'processing', 'deferred', 'queued', 'partial')
    AND status != 'failed'
    AND retry_count >= max_retries;

  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT id, status AS current_status
    FROM public.review_jobs
    WHERE (
      status IN ('pending', 'queued', 'partial')
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
      WHEN c.current_status IN ('processing', 'partial') THEN j.retry_count + 1
      ELSE j.retry_count
    END
  FROM candidate_jobs c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_review_jobs(INT, INT, BOOLEAN, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_review_jobs(INT, INT, BOOLEAN, INT) TO service_role;
