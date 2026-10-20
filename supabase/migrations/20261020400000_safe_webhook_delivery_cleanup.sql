-- Migration: Safe Webhook Delivery Cleanup function
-- Deletes webhook deliveries older than cutoff that are not referenced by review_jobs

CREATE OR REPLACE FUNCTION public.cleanup_old_webhook_deliveries(days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  IF days IS NULL OR days < 0 THEN
    RETURN 0;
  END IF;

  WITH to_delete AS (
    SELECT delivery_id
    FROM public.webhook_deliveries
    WHERE received_at < now() - (days || ' days')::interval
      AND delivery_id NOT IN (
        SELECT delivery_id
        FROM public.review_jobs
        WHERE delivery_id IS NOT NULL
      )
  ),
  deleted_rows AS (
    DELETE FROM public.webhook_deliveries
    WHERE delivery_id IN (SELECT delivery_id FROM to_delete)
    RETURNING delivery_id
  )
  SELECT count(*)::integer INTO deleted_count FROM deleted_rows;

  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_webhook_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_webhook_deliveries(integer) TO service_role;
