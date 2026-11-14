-- CreateTable
CREATE TABLE "HiringCleanupCursor" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "initialized" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "ledgerId" UUID,

    CONSTRAINT "HiringCleanupCursor_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."HiringCleanupCursor" ADD CONSTRAINT "HiringCleanupCursor_singleton" CHECK (id=1);
ALTER TABLE public."HiringCleanupCursor" ADD CONSTRAINT "HiringCleanupCursor_position" CHECK (
  (NOT initialized AND "ledgerId" IS NULL AND "createdAt" IS NULL AND "checkedAt" IS NULL)
  OR (initialized AND "ledgerId" IS NOT NULL AND "createdAt" IS NOT NULL)
);
ALTER TABLE public."HiringCleanupCursor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."HiringCleanupCursor" FROM PUBLIC, anon, authenticated;
INSERT INTO public."HiringCleanupCursor" (id) VALUES (1);

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
     OR c."spaceId" !~ '^c[a-z0-9]{24}$' OR jsonb_typeof(c.paths) IS DISTINCT FROM 'array' THEN
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
