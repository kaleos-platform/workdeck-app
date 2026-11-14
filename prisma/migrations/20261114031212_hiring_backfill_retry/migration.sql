-- AlterTable
ALTER TABLE "HiringUploadSession" ADD COLUMN     "cleanupRetryAt" TIMESTAMP(3);

-- 원본 식별자를 DB 밖으로 반환하지 않고 행별 실패를 지연한다.
CREATE FUNCTION public.hiring_run_upload_backfill(p_limit integer, p_ms integer)
RETURNS TABLE(scanned integer, failed integer, deadline_reached boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE item record; started timestamptz := clock_timestamp(); attempts integer := 0;
BEGIN
  IF p_limit IS NULL OR p_ms IS NULL OR p_limit < 1 OR p_limit > 500 OR p_ms < 1 OR p_ms > 2000 THEN
    RAISE EXCEPTION 'invalid backfill limits';
  END IF;
  scanned := 0; failed := 0; deadline_reached := false;
  WHILE attempts < p_limit LOOP
    IF clock_timestamp() >= started + p_ms * interval '1 millisecond' THEN
      deadline_reached := true; EXIT;
    END IF;
    SELECT id INTO item FROM public."HiringUploadSession"
      WHERE "cleanupBackfilledAt" IS NULL AND ("cleanupRetryAt" IS NULL OR "cleanupRetryAt" <= clock_timestamp())
      ORDER BY "createdAt", id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN EXIT; END IF;
    attempts := attempts + 1;
    BEGIN
      UPDATE public."HiringUploadSession" SET files = files, "cleanupBackfilledAt" = clock_timestamp(), "cleanupRetryAt" = NULL
        WHERE id = item.id AND "cleanupBackfilledAt" IS NULL;
      scanned := scanned + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public."HiringUploadSession" SET "cleanupRetryAt" = clock_timestamp() + interval '1 hour'
        WHERE id = item.id AND "cleanupBackfilledAt" IS NULL;
      failed := failed + 1;
    END;
  END LOOP;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.hiring_run_upload_backfill(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiring_run_upload_backfill(integer, integer) TO service_role;

CREATE FUNCTION public.hiring_upload_backfill_stats()
RETURNS TABLE(remaining integer, deferred integer, unverified integer, quarantined integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FILTER (WHERE s."cleanupBackfilledAt" IS NULL)::integer,
    count(*) FILTER (WHERE s."cleanupBackfilledAt" IS NULL AND s."cleanupRetryAt" > clock_timestamp())::integer,
    count(*) FILTER (WHERE s.files <> '[]'::jsonb AND
      (s.id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR s."spaceId" !~ '^c[a-z0-9]{24}$'))::integer,
    (SELECT count(*)::integer FROM public."HiringUploadCleanup" AS c WHERE c.quarantined)
  FROM public."HiringUploadSession" AS s
$$;
REVOKE ALL ON FUNCTION public.hiring_upload_backfill_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiring_upload_backfill_stats() TO service_role;
