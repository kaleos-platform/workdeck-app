/** @jest-environment node */
/**
 * Data API 잠금 회귀 방지 — public 스키마 모든 테이블이 RLS 활성이고 anon/authenticated/PUBLIC 권한이 0건인지 검사.
 * 신규 테이블은 기본 권한 회수(20261009120000)로 권한은 없지만 RLS 는 꺼진 채 생성된다.
 * 이 테스트는 적용된 DB 의 최종 상태를 검사한다. 마이그레이션마다 ENABLE ROW LEVEL SECURITY 를 넣었는지는
 * migration-rls-lint.test.ts 가 정적으로 강제한다(부트스트랩에서는 20261009120000 루프가 기준 테이블 RLS 를 켜 준다).
 * DB 준비: scripts/db/bootstrap-local.sh
 *
 * 로컬 Supabase(127.0.0.1) 에서만 실행한다 — 공유 dev/preview DB 에 DDL 프로브를 날리지 않기 위해.
 */
import path from 'path'
import { config } from 'dotenv'

// next/jest 는 테스트 모드에서 .env.local 을 읽지 않는다 — 기존 e2e 와 같이 직접 로드한다.
config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

// prisma.ts 는 비운영 환경에서 DIRECT_URL 을 우선 쓴다 — 같은 순서로 판정한다.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''
const RUN = /@(127\.0\.0\.1|localhost):/.test(url)
// CI 에서 조용히 skip 되면 초록불로 보인다 — CI 에서는 로컬 DB 가 아니면 실패시킨다.
if (process.env.CI && !RUN) throw new Error('CI 에서는 로컬 Supabase DATABASE_URL 이 필요합니다')
const d = RUN ? describe : describe.skip

// information_schema 는 조회 권한으로 행을 걸러내므로 pg_class 를 직접 본다.
const TABLES_WITHOUT_RLS = `
  SELECT c.relname AS name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  ORDER BY 1`

// ACL 을 직접 해석하지 않고 실효 권한(has_*_privilege)을 본다 — PUBLIC 경유 권한, NULL ACL 의 기본 권한,
// 역할 상속까지 한 번에 반영된다.
const ROLE_ACCESS = `
  SELECT c.relname AS name, r.role, 'table' AS kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  UNION ALL
  SELECT c.relname, r.role, 'sequence'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
  WHERE n.nspname = 'public' AND c.relkind = 'S'
    AND has_sequence_privilege(r.role, c.oid, 'USAGE,SELECT,UPDATE')
  UNION ALL
  SELECT p.proname, r.role, 'function'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
  WHERE n.nspname = 'public' AND has_function_privilege(r.role, p.oid, 'EXECUTE')
  ORDER BY 1, 2`

d('Data API 잠금 (RLS + 권한 회수)', () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('public 스키마의 모든 테이블은 RLS 가 켜져 있다', async () => {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(TABLES_WITHOUT_RLS)
    expect(rows.map((r) => r.name)).toEqual([])
  })

  test('anon/authenticated 는 public 객체에 실효 권한이 없다 (PUBLIC 경유 포함)', async () => {
    const rows =
      await prisma.$queryRawUnsafe<{ name: string; role: string; kind: string }[]>(ROLE_ACCESS)
    expect(rows).toEqual([])
  })

  test('검사 쿼리는 RLS 없는 신규 테이블을 실제로 잡아낸다 (프로브는 롤백)', async () => {
    const ROLLBACK = new Error('rollback-probe')
    let caught: string[] = []
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('CREATE TABLE public."__rls_probe" (id int)')
        const rows = await tx.$queryRawUnsafe<{ name: string }[]>(TABLES_WITHOUT_RLS)
        caught = rows.map((r) => r.name)
        throw ROLLBACK
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e
      })
    expect(caught).toContain('__rls_probe')
  })
})
