-- CreateTable
CREATE TABLE "HiringUploadCleanup" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "paths" JSONB NOT NULL,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringUploadCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringUploadCleanup_checkedAt_createdAt_idx" ON "HiringUploadCleanup"("checkedAt", "createdAt");

ALTER TABLE "HiringUploadCleanup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "HiringUploadCleanup" FROM PUBLIC, anon, authenticated;

-- 원본 파일명과 토큰을 보관하지 않고 검증된 경로만 합친다.
CREATE FUNCTION public.hiring_capture_cleanup(p_id text, p_space text, p_files jsonb, p_deleted boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE item jsonb; file_id text; file_path text; suffix text; paths jsonb := '[]'::jsonb; bad boolean := false;
BEGIN
  IF p_files = '[]'::jsonb THEN
    RETURN true;
  END IF;
  IF p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_space !~ '^c[a-z0-9]{24}$' THEN
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

CREATE FUNCTION public.hiring_cleanup_trigger() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.id IS DISTINCT FROM NEW.id OR OLD."spaceId" IS DISTINCT FROM NEW."spaceId") THEN
    RAISE EXCEPTION 'upload session identity is immutable';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.hiring_capture_cleanup(OLD.id, OLD."spaceId", OLD.files,
      TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.files IS DISTINCT FROM '[]'::jsonb AND NEW.files IS DISTINCT FROM OLD.files));
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.hiring_capture_cleanup(NEW.id, NEW."spaceId", NEW.files, false) THEN
      RAISE EXCEPTION 'upload session cannot be tracked';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.hiring_capture_cleanup(NEW.id, NEW."spaceId", NEW.files, false);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER hiring_cleanup_capture AFTER INSERT OR UPDATE OF files, id, "spaceId" ON public."HiringUploadSession" FOR EACH ROW EXECUTE FUNCTION public.hiring_cleanup_trigger();
CREATE TRIGGER hiring_cleanup_capture_delete BEFORE DELETE ON public."HiringUploadSession" FOR EACH ROW EXECUTE FUNCTION public.hiring_cleanup_trigger();
REVOKE ALL ON FUNCTION public.hiring_capture_cleanup(text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hiring_cleanup_trigger() FROM PUBLIC, anon, authenticated;
