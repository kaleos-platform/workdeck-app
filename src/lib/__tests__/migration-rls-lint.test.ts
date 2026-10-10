/** @jest-environment node */
/**
 * 신규 마이그레이션 정적 검사 — Data API 잠금(20261009120000) 이후 마이그레이션은
 *   1) 만드는 테이블마다 ENABLE ROW LEVEL SECURITY 를 넣고
 *   2) anon/authenticated 에 GRANT 하지 않고
 *   3) DISABLE ROW LEVEL SECURITY 를 쓰지 않는다.
 *
 * rls-lockdown.e2e.test.ts 는 기준 스키마 부트스트랩 DB 를 검사하므로 신규 마이그레이션의 RLS 누락을
 * 놓칠 수 있다. 이 검사는 DB 없이 SQL 파일만 본다.
 */
import fs from 'fs'
import path from 'path'

const LOCKDOWN = '20261009120000'
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'prisma/migrations')

const NAME = String.raw`(?:"?public"?\.)?"?(\w+)"?`

function lintMigration(sql: string): string[] {
  const code = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const created = [
    ...code.matchAll(
      new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, 'gi')
    ),
  ].map((m) => m[1])
  const enabled = new Set(
    [
      ...code.matchAll(
        new RegExp(
          String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${NAME}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`,
          'gi'
        )
      ),
    ].map((m) => m[1])
  )
  const errors = created.filter((t) => !enabled.has(t)).map((t) => `RLS 누락: ${t}`)
  if (/\bGRANT\b[^;]*\bTO\b[^;]*\b(anon|authenticated)\b/i.test(code))
    errors.push('anon/authenticated GRANT')
  if (/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(code)) errors.push('DISABLE ROW LEVEL SECURITY')
  return errors
}

describe('lintMigration', () => {
  test('RLS 를 켠 신규 테이블은 통과한다', () => {
    expect(
      lintMigration('CREATE TABLE "A" ("id" TEXT);\nALTER TABLE "A" ENABLE ROW LEVEL SECURITY;')
    ).toEqual([])
  })

  test('RLS 없는 신규 테이블을 잡는다', () => {
    expect(
      lintMigration(
        'CREATE TABLE "A" ("id" TEXT);\nCREATE TABLE "B" ("id" TEXT);\nALTER TABLE "B" ENABLE ROW LEVEL SECURITY;'
      )
    ).toEqual(['RLS 누락: A'])
  })

  test('anon/authenticated GRANT 와 DISABLE RLS 를 잡는다', () => {
    expect(lintMigration('GRANT SELECT ON "A" TO anon;')).toEqual(['anon/authenticated GRANT'])
    expect(
      lintMigration('GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated;')
    ).toEqual(['anon/authenticated GRANT'])
    expect(lintMigration('ALTER TABLE "A" DISABLE ROW LEVEL SECURITY;')).toEqual([
      'DISABLE ROW LEVEL SECURITY',
    ])
  })

  test('주석 안의 문구는 무시한다', () => {
    expect(lintMigration('-- GRANT SELECT ON "A" TO anon;\n/* CREATE TABLE "B" */')).toEqual([])
  })
})

test(`${LOCKDOWN} 이후 마이그레이션은 RLS·권한 규칙을 지킨다`, () => {
  const violations = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((dir) => /^\d{14}_/.test(dir) && dir.slice(0, 14) > LOCKDOWN)
    .map(
      (dir) =>
        [
          dir,
          lintMigration(fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8')),
        ] as const
    )
    .filter(([, errors]) => errors.length > 0)
  expect(Object.fromEntries(violations)).toEqual({})
})
