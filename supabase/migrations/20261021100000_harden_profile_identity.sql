-- Migration: Prevent authenticated users from modifying their GitHub identity fields
-- Only service_role (e.g. auth callback) can set github_user_id and github_username.

REVOKE UPDATE (github_user_id, github_username) ON public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) = 'authenticated' THEN
    IF NEW.github_user_id IS DISTINCT FROM OLD.github_user_id THEN
      RAISE EXCEPTION 'Cannot modify github_user_id';
    END IF;
    IF NEW.github_username IS DISTINCT FROM OLD.github_username THEN
      RAISE EXCEPTION 'Cannot modify github_username';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_profile_identity() TO service_role;

CREATE OR REPLACE TRIGGER check_profile_identity_immutability
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_identity();
