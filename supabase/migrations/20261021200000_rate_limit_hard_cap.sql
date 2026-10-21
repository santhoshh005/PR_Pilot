-- Migration: Bounded Rate Limit Storage and Hard Row Cap
-- Ensures rate_limits table cannot grow unbounded under volumetric key flooding.

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
    v_total_rows INTEGER;
    c_max_rows CONSTANT INTEGER := 50000;
BEGIN
    -- If key does NOT exist, check if table size exceeds safe cap
    IF NOT EXISTS (SELECT 1 FROM public.rate_limits WHERE key = p_key) THEN
        SELECT pg_catalog.count(*) INTO v_total_rows FROM public.rate_limits;
        IF v_total_rows >= c_max_rows THEN
            -- Eagerly prune expired entries
            DELETE FROM public.rate_limits WHERE reset_at < v_now;
            SELECT pg_catalog.count(*) INTO v_total_rows FROM public.rate_limits;
            -- If still at capacity, reject the request to protect database storage
            IF v_total_rows >= c_max_rows THEN
                RETURN QUERY SELECT FALSE, 0, v_now + (p_window_seconds || ' seconds')::interval, p_window_seconds;
                RETURN;
            END IF;
        END IF;
    END IF;

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

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
