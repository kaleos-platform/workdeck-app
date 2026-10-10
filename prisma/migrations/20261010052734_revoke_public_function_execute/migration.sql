-- 20261009120000 은 anon/authenticated 만 회수했다. PUBLIC(모든 역할) 경유 권한도 막는다.
-- 함수는 생성 시 PUBLIC 에 EXECUTE 가 암묵 부여되므로 anon/authenticated 가 PUBLIC 을 통해 실행할 수 있다.
-- 소유자(postgres)는 권한 회수와 무관하게 EXECUTE 를 유지한다.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

-- 기본 권한(ALTER DEFAULT PRIVILEGES ... IN SCHEMA public ... FROM PUBLIC)은 쓰지 않는다.
-- 스키마별 기본 권한은 전역 기본값(PUBLIC 의 함수 EXECUTE)을 회수하지 못해 효과가 없고,
-- 전역 형태는 public 밖의 모든 스키마에 영향을 준다.
-- 대신 새 함수는 같은 마이그레이션에서 REVOKE EXECUTE ... FROM PUBLIC 을 넣는다(migration-rls-lint 가 강제).
