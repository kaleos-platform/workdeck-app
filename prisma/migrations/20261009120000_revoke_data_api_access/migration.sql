-- public 스키마는 서버(Prisma, postgres role)에서만 접근한다.
-- Supabase Data API(PostgREST)에 노출된 anon/authenticated 권한을 회수해,
-- 브라우저에 공개된 anon 키로 테이블을 읽고 쓰지 못하게 막는다.
-- 테이블 owner(postgres)는 RLS를 우회하므로 Prisma 동작에는 영향이 없다.

-- 1) 기존 테이블: RLS 활성화 (정책 없음 = anon/authenticated 전면 차단)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END
$$;

-- 2) 기존 객체 권한 회수
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 3) 앞으로 생성될 객체도 자동 노출되지 않도록 기본 권한 회수
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
