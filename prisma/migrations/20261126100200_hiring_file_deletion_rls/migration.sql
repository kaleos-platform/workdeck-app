-- 삭제 원장은 서버(service role·Prisma)만 접근한다. 공개 anon/authenticated 키 접근 차단.
ALTER TABLE "HiringFileDeletion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "HiringFileDeletion" FROM PUBLIC, anon, authenticated;
