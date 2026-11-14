-- AlterTable
ALTER TABLE "HiringUploadCleanup" ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "leaseToken" UUID,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "retiredAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "HiringUploadCleanup_leaseToken_key" ON "HiringUploadCleanup"("leaseToken");
CREATE INDEX "HiringApplicationFile_filePath_idx" ON "HiringApplicationFile"("filePath");

-- 구버전 정리기의 만료 세션 claim을 차단한다. 취소와 완료는 requestHash를 변경한다.
CREATE FUNCTION public.hiring_fence_v1_claim() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD."completedAt" IS NULL AND NEW."claimedAt" IS NOT NULL
     AND (OLD."expiresAt" IS NULL OR OLD."expiresAt" <= clock_timestamp()) THEN
    IF NEW."requestHash" = 'recovery-cancelled-v1' AND NEW."requestHash" IS DISTINCT FROM OLD."requestHash" THEN
      RETURN NEW;
    END IF;
    RETURN NULL;
  END IF;
  IF OLD."completedAt" IS NULL AND NEW."claimedAt" IS NOT NULL
     AND OLD."expiresAt" < NEW."claimedAt" AND NEW."requestHash" IS NOT DISTINCT FROM OLD."requestHash" THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hiring_fence_v1_claim BEFORE UPDATE OF "claimedAt" ON public."HiringUploadSession"
FOR EACH ROW EXECUTE FUNCTION public.hiring_fence_v1_claim();
REVOKE ALL ON FUNCTION public.hiring_fence_v1_claim() FROM PUBLIC, anon, authenticated;

-- 은퇴 원장의 경로 집합은 바꿀 수 없다. 동일한 files 재검사는 허용한다.
CREATE FUNCTION public.hiring_guard_retired_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE retired timestamptz;
BEGIN
  SELECT c."retiredAt" INTO retired FROM public."HiringUploadCleanup" AS c WHERE c.id=NEW.id FOR UPDATE;
  IF retired IS NOT NULL THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'upload session cannot be changed'; END IF;
    IF OLD.files IS DISTINCT FROM NEW.files THEN RAISE EXCEPTION 'upload session cannot be changed'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hiring_guard_retired_session BEFORE INSERT OR UPDATE OF files ON public."HiringUploadSession"
FOR EACH ROW EXECUTE FUNCTION public.hiring_guard_retired_session();
REVOKE ALL ON FUNCTION public.hiring_guard_retired_session() FROM PUBLIC, anon, authenticated;

-- 파일 참조 생성과 변경은 원장에 같은 행 잠금을 획득한다.
CREATE FUNCTION public.hiring_guard_file_reference() RETURNS trigger
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
  IF parts[1] !~ '^c[a-z0-9]{24}$' OR parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
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
CREATE TRIGGER hiring_guard_file_reference BEFORE INSERT OR UPDATE OF "filePath", "applicationId", "spaceId"
ON public."HiringApplicationFile" FOR EACH ROW EXECUTE FUNCTION public.hiring_guard_file_reference();
REVOKE ALL ON FUNCTION public.hiring_guard_file_reference() FROM PUBLIC, anon, authenticated;

-- 호출 트랜잭션이 commit된 뒤에만 반환된 경로를 Storage에 전달한다.
CREATE FUNCTION public.hiring_claim_upload_cleanup()
RETURNS TABLE(outcome text, token uuid, paths jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."HiringUploadCleanup"%ROWTYPE; s public."HiringUploadSession"%ROWTYPE;
  candidate_id text; had_session boolean; locked boolean := false; excluded text[] := '{}'; p jsonb; value text; parts text[];
BEGIN
  FOR attempt IN 1..50 LOOP
    SELECT x.id INTO candidate_id FROM public."HiringUploadCleanup" AS x
      WHERE NOT x.quarantined AND x."createdAt" < clock_timestamp()-interval '3 hours'
        AND (x."checkedAt" IS NULL OR x."checkedAt" < clock_timestamp()-interval '1 hour')
        AND (x."leaseUntil" IS NULL OR x."leaseUntil" < clock_timestamp())
        AND NOT (x.id = ANY(excluded))
      ORDER BY x."checkedAt" ASC NULLS FIRST, x."createdAt", x.id LIMIT 1;
    IF NOT FOUND THEN
      IF cardinality(excluded)>0 THEN outcome:='blocked'; token:=NULL; paths:='[]'::jsonb; RETURN NEXT; END IF;
      RETURN;
    END IF;
    excluded := array_append(excluded, candidate_id);
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

CREATE FUNCTION public.hiring_finish_upload_cleanup(p_token uuid, p_success boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_token IS NULL OR p_success IS NULL THEN RETURN false; END IF;
  UPDATE public."HiringUploadCleanup" SET "leaseToken"=NULL, "leaseUntil"=NULL,
    "checkedAt"=clock_timestamp(), "failedCount"="failedCount" + CASE WHEN p_success THEN 0 ELSE 1 END
    WHERE "leaseToken"=p_token AND "retiredAt" IS NOT NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.hiring_finish_upload_cleanup(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiring_finish_upload_cleanup(uuid, boolean) TO service_role;

CREATE FUNCTION public.hiring_upload_cleanup_stats()
RETURNS TABLE(due integer, lag_seconds integer, quarantined_total integer, failed_total integer)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH candidate AS (
    SELECT c.quarantined, c."failedCount",
      greatest(c."createdAt" + interval '3 hours',
        coalesce(c."checkedAt" + interval '1 hour', '-infinity'::timestamptz),
        coalesce(c."leaseUntil", '-infinity'::timestamptz)) AS due_at
    FROM public."HiringUploadCleanup" AS c
  )
  SELECT count(*) FILTER (WHERE NOT c.quarantined AND c.due_at < clock_timestamp())::integer,
    coalesce(extract(epoch FROM clock_timestamp() - min(c.due_at) FILTER (WHERE NOT c.quarantined AND c.due_at < clock_timestamp()))::integer, 0),
    count(*) FILTER (WHERE c.quarantined)::integer,
    coalesce(sum(c."failedCount"),0)::integer
  FROM candidate AS c
$$;
REVOKE ALL ON FUNCTION public.hiring_upload_cleanup_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiring_upload_cleanup_stats() TO service_role;
