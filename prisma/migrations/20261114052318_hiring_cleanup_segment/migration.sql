-- 기존 Space 식별자는 안전한 단일 segment면 원본 경로 그대로 보존한다.

CREATE OR REPLACE FUNCTION public.hiring_capture_cleanup(p_id text, p_space text, p_files jsonb, p_deleted boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE item jsonb; file_id text; file_path text; suffix text; paths jsonb := '[]'::jsonb; bad boolean := false;
BEGIN
  IF p_files = '[]'::jsonb THEN
    RETURN true;
  END IF;
  IF p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (p_space COLLATE "C") !~ '^[A-Za-z0-9_-]+$' THEN
    IF p_deleted THEN
      INSERT INTO public."HiringUploadCleanup" (id, "spaceId", paths, quarantined)
      VALUES ('quarantine:' || gen_random_uuid()::text, '', '[]'::jsonb, true);
    END IF;
    RETURN false;
  END IF;
  IF jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN
    bad := true;
  ELSE
    FOR item IN SELECT * FROM jsonb_array_elements(p_files) LOOP
      file_id := item->>'id'; file_path := item->>'path';
      suffix := substring(file_path from '\.([a-z0-9]+)$');
      IF file_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         AND suffix IN ('png','jpg','webp','pdf','doc','docx','xls','xlsx','hwp')
         AND file_path = p_space || '/applications/' || p_id || '/' || file_id || '.' || suffix THEN
        paths := paths || jsonb_build_array(file_path);
      ELSE bad := true;
      END IF;
    END LOOP;
  END IF;
  IF jsonb_array_length(paths) > 0 OR bad THEN
    INSERT INTO public."HiringUploadCleanup" (id, "spaceId", paths, quarantined)
    VALUES (p_id, p_space, paths, bad)
    ON CONFLICT (id) DO UPDATE SET
      paths = CASE WHEN public."HiringUploadCleanup"."spaceId" = EXCLUDED."spaceId" THEN
        (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(public."HiringUploadCleanup".paths || EXCLUDED.paths) x)
        ELSE public."HiringUploadCleanup".paths END,
      quarantined = public."HiringUploadCleanup".quarantined OR EXCLUDED.quarantined OR public."HiringUploadCleanup"."spaceId" <> EXCLUDED."spaceId";
  END IF;
  RETURN NOT bad;
END $$;
REVOKE ALL ON FUNCTION public.hiring_capture_cleanup(text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hiring_upload_backfill_stats()
RETURNS TABLE(remaining integer, deferred integer, unverified integer, quarantined integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FILTER (WHERE s."cleanupBackfilledAt" IS NULL)::integer,
    count(*) FILTER (WHERE s."cleanupBackfilledAt" IS NULL AND s."cleanupRetryAt" > clock_timestamp())::integer,
    count(*) FILTER (WHERE s.files <> '[]'::jsonb AND
      (s.id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR (s."spaceId" COLLATE "C") !~ '^[A-Za-z0-9_-]+$'))::integer,
    (SELECT count(*)::integer FROM public."HiringUploadCleanup" AS c WHERE c.quarantined)
  FROM public."HiringUploadSession" AS s
$$;

CREATE OR REPLACE FUNCTION public.hiring_guard_file_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parts text[]; s public."HiringUploadSession"%ROWTYPE; c public."HiringUploadCleanup"%ROWTYPE; valid_session boolean;
BEGIN
  parts := string_to_array(NEW."filePath", '/');
  IF cardinality(parts) <> 4 OR parts[1] <> NEW."spaceId"
     OR NOT EXISTS (SELECT 1 FROM public."HiringApplication" AS a WHERE a.id=NEW."applicationId" AND a."spaceId"=NEW."spaceId") THEN
    RAISE EXCEPTION 'file reference rejected';
  END IF;
  IF parts[2] = 'migration' AND parts[3] ~ '^[0-9a-f]{64}$' AND parts[4] ~ '^[0-9a-f]{64}$' THEN RETURN NEW; END IF;
  IF parts[2] <> 'applications' OR parts[3] <> NEW."applicationId"
     OR parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|doc|docx|xls|xlsx|hwp)$' THEN
    RAISE EXCEPTION 'file reference rejected';
  END IF;
  IF parts[3] ~ '^c[a-z0-9]{24}$' THEN RETURN NEW; END IF;
  IF (parts[1] COLLATE "C") !~ '^[A-Za-z0-9_-]+$' OR parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'file reference rejected';
  END IF;
  SELECT * INTO s FROM public."HiringUploadSession" WHERE id=parts[3] FOR UPDATE;
  IF FOUND THEN
    IF s."completedAt" IS NULL AND (s."expiresAt" IS NULL OR s."expiresAt" <= clock_timestamp()) THEN
      RAISE EXCEPTION 'file reference rejected';
    END IF;
    valid_session := public.hiring_capture_cleanup(s.id, s."spaceId", s.files, false);
    IF NOT valid_session THEN RAISE EXCEPTION 'file reference rejected'; END IF;
  END IF;
  SELECT * INTO c FROM public."HiringUploadCleanup" WHERE id=parts[3] FOR UPDATE;
  IF NOT FOUND OR c."spaceId" <> NEW."spaceId" OR c.quarantined OR c."retiredAt" IS NOT NULL
     OR NOT (c.paths @> jsonb_build_array(NEW."filePath")) THEN
    RAISE EXCEPTION 'file reference rejected';
  END IF;
  UPDATE public."HiringUploadCleanup" SET "checkedAt"="checkedAt" WHERE id=c.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hiring_guard_file_reference() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hiring_claim_upload_cleanup()
RETURNS TABLE(outcome text, token uuid, paths jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."HiringUploadCleanup"%ROWTYPE; s public."HiringUploadSession"%ROWTYPE;
  pos public."HiringCleanupCursor"%ROWTYPE; next_checked timestamp; next_created timestamp;
  candidate_id text; had_session boolean; locked boolean := false; excluded text[] := '{}'; p jsonb; value text; parts text[];
BEGIN
  SELECT * INTO pos FROM public."HiringCleanupCursor" WHERE id=1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN outcome:='blocked'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN; END IF;
  SELECT x.id INTO candidate_id FROM public."HiringUploadCleanup" AS x
    WHERE NOT x.quarantined AND x.id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND x."createdAt" < clock_timestamp()-interval '3 hours'
      AND (x."checkedAt" IS NULL OR x."checkedAt" < clock_timestamp()-interval '1 hour')
      AND (x."leaseUntil" IS NULL OR x."leaseUntil" < clock_timestamp())
    ORDER BY x."checkedAt" ASC NULLS FIRST, x."createdAt", x.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    UPDATE public."HiringUploadCleanup" SET quarantined=true WHERE id=candidate_id;
    outcome:='quarantined'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN;
  END IF;
  FOR attempt IN 1..100 LOOP
    SELECT x.id, x."checkedAt", x."createdAt" INTO candidate_id, next_checked, next_created FROM public."HiringUploadCleanup" AS x
      WHERE NOT x.quarantined AND x."createdAt" < clock_timestamp()-interval '3 hours'
        AND x.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (x."checkedAt" IS NULL OR x."checkedAt" < clock_timestamp()-interval '1 hour')
        AND (x."leaseUntil" IS NULL OR x."leaseUntil" < clock_timestamp())
        AND NOT (x.id = ANY(excluded))
        AND (NOT pos.initialized
          OR (pos."checkedAt" IS NULL AND (x."checkedAt" IS NOT NULL OR
            (x."checkedAt" IS NULL AND (x."createdAt", x.id) > (pos."createdAt", pos."ledgerId"::text))))
          OR (pos."checkedAt" IS NOT NULL AND x."checkedAt" IS NOT NULL AND
            (x."checkedAt", x."createdAt", x.id) > (pos."checkedAt", pos."createdAt", pos."ledgerId"::text)))
      ORDER BY x."checkedAt" ASC NULLS FIRST, x."createdAt", x.id LIMIT 1;
    IF NOT FOUND THEN
      IF pos.initialized THEN pos.initialized := false; CONTINUE; END IF;
      IF cardinality(excluded)>0 THEN outcome:='blocked'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; END IF;
      RETURN;
    END IF;
    excluded := array_append(excluded, candidate_id);
    pos.initialized:=true; pos."checkedAt":=next_checked; pos."createdAt":=next_created; pos."ledgerId":=candidate_id::uuid;
    UPDATE public."HiringCleanupCursor" SET initialized=true, "checkedAt"=next_checked, "createdAt"=next_created, "ledgerId"=candidate_id::uuid WHERE id=1;
    BEGIN
      SELECT EXISTS (SELECT 1 FROM public."HiringUploadSession" AS x WHERE x.id=candidate_id) INTO had_session;
      IF had_session THEN
        SELECT * INTO s FROM public."HiringUploadSession" AS x WHERE x.id=candidate_id FOR UPDATE SKIP LOCKED;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='candidate unavailable'; END IF;
      END IF;
      SELECT * INTO c FROM public."HiringUploadCleanup" AS x WHERE x.id=candidate_id
        AND NOT x.quarantined AND x."createdAt" < clock_timestamp()-interval '3 hours'
        AND (x."checkedAt" IS NULL OR x."checkedAt" < clock_timestamp()-interval '1 hour')
        AND (x."leaseUntil" IS NULL OR x."leaseUntil" < clock_timestamp()) FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='candidate unavailable'; END IF;
      IF NOT had_session AND EXISTS (SELECT 1 FROM public."HiringUploadSession" AS x WHERE x.id=candidate_id) THEN
        RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='candidate unavailable';
      END IF;
      locked := true;
    EXCEPTION WHEN SQLSTATE 'PT001' THEN
      NULL;
    END;
    IF locked THEN EXIT; END IF;
    IF cardinality(excluded)>=50 THEN EXIT; END IF;
  END LOOP;
  IF NOT locked THEN outcome:='skipped_limit'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN; END IF;
  IF had_session AND ((s."completedAt" IS NULL AND s."applicationId" IS NOT NULL)
      OR (s."completedAt" IS NOT NULL AND s."applicationId" IS DISTINCT FROM s.id)) THEN
    UPDATE public."HiringUploadCleanup" SET quarantined=true WHERE id=c.id;
    outcome:='quarantined'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN;
  END IF;
  IF had_session AND s."completedAt" IS NULL AND (s."expiresAt" IS NULL OR s."expiresAt" >= clock_timestamp()) THEN
    UPDATE public."HiringUploadCleanup" SET "checkedAt"=clock_timestamp() WHERE id=c.id;
    outcome:='active'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN;
  END IF;
  IF c.id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (c."spaceId" COLLATE "C") !~ '^[A-Za-z0-9_-]+$' OR jsonb_typeof(c.paths) IS DISTINCT FROM 'array' THEN
    UPDATE public."HiringUploadCleanup" SET quarantined=true WHERE id=c.id;
    outcome:='quarantined'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN;
  END IF;
  IF jsonb_array_length(c.paths)=0 OR jsonb_array_length(c.paths)>3 THEN
    UPDATE public."HiringUploadCleanup" SET quarantined=true WHERE id=c.id;
    outcome:='quarantined'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN;
  END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(c.paths) LOOP
    value := p #>> '{}'; parts := string_to_array(value,'/');
    IF jsonb_typeof(p) <> 'string' OR cardinality(parts) <> 4 OR parts[1] <> c."spaceId"
       OR parts[2] <> 'applications' OR parts[3] <> c.id
       OR parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|doc|docx|xls|xlsx|hwp)$' THEN
      UPDATE public."HiringUploadCleanup" SET quarantined=true WHERE id=c.id;
      outcome:='quarantined'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM (SELECT v.entry FROM jsonb_array_elements_text(c.paths) AS v(entry) LIMIT 3) AS expanded
    JOIN public."HiringApplicationFile" AS f ON f."filePath"=expanded.entry) THEN
    UPDATE public."HiringUploadCleanup" SET "checkedAt"=clock_timestamp() WHERE id=c.id;
    outcome:='referenced'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; RETURN;
  END IF;
  token:=gen_random_uuid();
  UPDATE public."HiringUploadCleanup" SET "retiredAt"=COALESCE("retiredAt",clock_timestamp()),
    "leaseToken"=token, "leaseUntil"=clock_timestamp()+interval '5 minutes', "checkedAt"=clock_timestamp()
    WHERE id=c.id;
  outcome:='retired'; paths:=c.paths; RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.hiring_claim_upload_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiring_claim_upload_cleanup() TO service_role;
REVOKE ALL ON FUNCTION public.hiring_upload_backfill_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiring_upload_backfill_stats() TO service_role;
