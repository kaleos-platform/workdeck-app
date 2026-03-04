-- reports 버킷 및 Storage RLS 정책 생성
-- 목적: 업로드 경로의 인프라 규칙을 앱 코드가 아닌 DB 마이그레이션으로 고정

-- 1) reports 버킷 생성 (이미 있으면 유지)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('reports', 'reports', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- 2) reports 버킷 owner 기반 접근 정책
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'reports_insert_owner_only'
  ) THEN
    CREATE POLICY "reports_insert_owner_only"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'reports' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'reports_select_owner_only'
  ) THEN
    CREATE POLICY "reports_select_owner_only"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'reports' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'reports_delete_owner_only'
  ) THEN
    CREATE POLICY "reports_delete_owner_only"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'reports' AND owner = auth.uid());
  END IF;
END
$$;
