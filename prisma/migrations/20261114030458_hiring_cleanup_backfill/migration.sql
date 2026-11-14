-- AlterTable
ALTER TABLE "HiringUploadSession" ADD COLUMN     "cleanupBackfilledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "HiringUploadSession_cleanupBackfilledAt_createdAt_id_idx" ON "HiringUploadSession"("cleanupBackfilledAt", "createdAt", "id");

-- 신규 세션은 1단계 수집 trigger와 같은 트랜잭션에서 처리 완료로 표시한다.
CREATE FUNCTION public.hiring_cleanup_mark_new() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $$
BEGIN
  NEW."cleanupBackfilledAt" := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER hiring_cleanup_mark_new BEFORE INSERT ON public."HiringUploadSession"
FOR EACH ROW EXECUTE FUNCTION public.hiring_cleanup_mark_new();
REVOKE ALL ON FUNCTION public.hiring_cleanup_mark_new() FROM PUBLIC, anon, authenticated;
