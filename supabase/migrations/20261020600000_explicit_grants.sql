-- Migration: Explicit Grants for Existing Tables and Functions
-- Restates live grants on schema public for anon, authenticated, and service_role
-- Ensures compatibility with Supabase post-Oct 30 auto-grant deprecation and fresh DB resets.

-- 1. User-facing tables (access controlled by Row Level Security policies)
GRANT ALL ON TABLE public.daily_api_usage TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.installations TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.repo_settings TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.repos TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.review_chunks TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.review_comments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.review_jobs TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.reviews TO anon, authenticated, service_role;

-- 2. Internal tables: service_role only
GRANT ALL ON TABLE public.webhook_deliveries TO service_role;
GRANT ALL ON TABLE public.rate_limits TO service_role;

-- 3. Trigger helper functions
GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO anon, authenticated, service_role;

-- 4. Internal and atomic RPC functions: service_role only
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_review_jobs(integer, integer, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_webhook_deliveries(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_daily_api_usage(date) TO service_role;
