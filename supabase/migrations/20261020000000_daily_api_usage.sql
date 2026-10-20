-- Migration: Daily API usage tracking and expanded statuses
-- Task 8: Review processor and orchestrator safety

-- 1. Daily API usage table
CREATE TABLE IF NOT EXISTS public.daily_api_usage (
  usage_date DATE PRIMARY KEY,
  call_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_api_usage ENABLE ROW LEVEL SECURITY;

-- Block public access; table is managed server-side via service role
CREATE POLICY daily_api_usage_select ON public.daily_api_usage
  FOR SELECT TO authenticated
  USING (false);

-- 2. Atomic increment function for daily API calls
CREATE OR REPLACE FUNCTION public.increment_daily_api_usage(usage_day DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO public.daily_api_usage (usage_date, call_count, updated_at)
  VALUES (usage_day, 1, now())
  ON CONFLICT (usage_date)
  DO UPDATE SET
    call_count = public.daily_api_usage.call_count + 1,
    updated_at = now()
  RETURNING call_count INTO new_count;

  RETURN new_count;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.increment_daily_api_usage(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_daily_api_usage(DATE) TO service_role;

-- 3. Expand review_jobs status constraint to include 'deferred' and 'partial'
ALTER TABLE public.review_jobs
  DROP CONSTRAINT IF EXISTS review_jobs_status_check;

ALTER TABLE public.review_jobs
  ADD CONSTRAINT review_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'error', 'skipped', 'deferred', 'partial'));

-- 4. Expand review_chunks status constraint to include 'retry_later'
ALTER TABLE public.review_chunks
  DROP CONSTRAINT IF EXISTS review_chunks_status_check;

ALTER TABLE public.review_chunks
  ADD CONSTRAINT review_chunks_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'error', 'retry_later'));
