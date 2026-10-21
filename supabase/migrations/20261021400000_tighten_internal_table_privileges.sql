-- Migration: Revoke authenticated table access from internal tables
-- daily_api_usage, webhook_deliveries, rate_limits, and review_chunks are internal
-- and must only be accessed by service_role (background workers and server-side RPCs).

REVOKE ALL ON TABLE public.daily_api_usage FROM authenticated, anon, PUBLIC;
REVOKE ALL ON TABLE public.webhook_deliveries FROM authenticated, anon, PUBLIC;
REVOKE ALL ON TABLE public.rate_limits FROM authenticated, anon, PUBLIC;
REVOKE ALL ON TABLE public.review_chunks FROM authenticated, anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_api_usage TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.webhook_deliveries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.review_chunks TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
