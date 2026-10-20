-- Migration: Rate Limiting Table and Atomic Function
-- PLAN.md Task 13: Rate Limiter

CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    reset_at TIMESTAMPTZ NOT NULL
);

-- Enable Row Level Security (internal table, service_role only)
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Explicit least-privilege GRANTs (Oct 30+ compliance)
-- Revoke all access from public, anon, and authenticated
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;
-- Grant access strictly to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limits TO service_role;

-- Atomic SECURITY DEFINER function to check and increment rate limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_key TEXT,
    p_limit INTEGER,
    p_window_seconds INTEGER
)
RETURNS TABLE (
    allowed BOOLEAN,
    remaining INTEGER,
    reset_at TIMESTAMPTZ,
    retry_after INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_reset_at TIMESTAMPTZ;
    v_count INTEGER;
    v_retry_after INTEGER := 0;
BEGIN
    INSERT INTO public.rate_limits (key, count, reset_at)
    VALUES (p_key, 1, v_now + (p_window_seconds || ' seconds')::interval)
    ON CONFLICT (key) DO UPDATE
    SET
        count = CASE
            WHEN public.rate_limits.reset_at <= v_now THEN 1
            ELSE public.rate_limits.count + 1
        END,
        reset_at = CASE
            WHEN public.rate_limits.reset_at <= v_now THEN v_now + (p_window_seconds || ' seconds')::interval
            ELSE public.rate_limits.reset_at
        END
    RETURNING public.rate_limits.count, public.rate_limits.reset_at
    INTO v_count, v_reset_at;

    IF v_count > p_limit THEN
        v_retry_after := pg_catalog.ceil(pg_catalog.date_part('epoch', v_reset_at - v_now))::INTEGER;
        IF v_retry_after < 1 THEN
            v_retry_after := 1;
        END IF;
        RETURN QUERY SELECT FALSE, 0, v_reset_at, v_retry_after;
    ELSE
        RETURN QUERY SELECT TRUE, CASE WHEN p_limit > v_count THEN (p_limit - v_count) ELSE 0 END, v_reset_at, 0;
    END IF;
END;
$$;

-- Revoke execute from public, anon, and authenticated; grant strictly to service_role
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- Cleanup function for expired rate limit rows (prevents unbounded table growth)
CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits(
    p_older_than_seconds INTEGER DEFAULT 3600
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.rate_limits
    WHERE reset_at < (pg_catalog.clock_timestamp() - (p_older_than_seconds || ' seconds')::interval);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits(INTEGER) TO service_role;
