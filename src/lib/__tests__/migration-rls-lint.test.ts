/** @jest-environment node */
/**
 * 신규 마이그레이션 정적 검사 — 기준 목록(scripts/db/baseline-migrations.txt) 밖의 마이그레이션은
 *   1) 만드는 테이블마다 ENABLE ROW LEVEL SECURITY 를 넣고
 *   2) anon/authenticated/PUBLIC 에 GRANT 하지 않고
 *   3) DISABLE ROW LEVEL SECURITY 를 쓰지 않고
 *   4) public 함수를 만들면 같은 마이그레이션에서 PUBLIC 의 EXECUTE 를 회수한다.
 * 주석·문자열·달러 인용을 지운 뒤 정규식으로 본다 — 동적 SQL(EXECUTE format(...))로 만드는 객체는 e2e 테스트가 잡는다.
 *
 * rls-lockdown.e2e.test.ts 는 기준 스키마 부트스트랩 DB 를 검사하므로 신규 마이그레이션의 RLS 누락을
 * 놓칠 수 있다. 이 검사는 DB 없이 SQL 파일만 본다.
 */
import fs from 'fs'
import path from 'path'

const LOCKDOWN = '20261009120000'
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'prisma/migrations')

// 식별자: "따옴표" 또는 맨 이름. 스키마 한정(schema.name)까지 캡처한다.
const IDENT = String.raw`(?:"[^"]+"|\w+)`
const QNAME = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`

// Postgres 규칙대로 맨 이름은 소문자로 접는다. public 이 아닌 스키마로 한정된 이름은 null.
function publicName(raw: string): string | null {
  const parts = raw
    .split(/\s*\.\s*/)
    .map((p) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()))
  if (parts.length === 2 && parts[0] !== 'public') return null
  return parts[parts.length - 1]
}

function names(code: string, pattern: string): string[] {
  return [...code.matchAll(new RegExp(pattern, 'gi'))]
    .map((m) => publicName(m[1]))
    .filter((n): n is string => n !== null)
}

// 주석, 문자열('' 이스케이프, E'' 백슬래시 이스케이프), 달러 인용($$…$$, $tag$…$tag$)을 공백으로 지운다.
// "따옴표 식별자" 는 이름 매칭에 필요하므로 그대로 둔다.
function stripSql(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const rest = sql.slice(i)
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      out += ' '
    } else if (rest.startsWith('/*')) {
      // Postgres 블록 주석은 중첩된다.
      let depth = 0
      do {
        if (sql.startsWith('/*', i)) {
          depth++
          i += 2
        } else if (sql.startsWith('*/', i)) {
          depth--
          i += 2
        } else i++
      } while (depth > 0 && i < sql.length)
      out += ' '
    } else if (c === "'") {
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/\w/.test(sql[i - 2] ?? '')
      i++
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') i += 2
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else i++
      }
      i++
      out += ' '
    } else if (c === '"') {
      const end = sql.indexOf('"', i + 1)
      const stop = end === -1 ? sql.length : end + 1
      out += sql.slice(i, stop)
      i = stop
    } else if (c === '$' && !/\w/.test(sql[i - 1] ?? '') && /^\$(?:[A-Za-z_]\w*)?\$/.test(rest)) {
      const tag = rest.match(/^\$(?:[A-Za-z_]\w*)?\$/)![0]
      const end = sql.indexOf(tag, i + tag.length)
      i = end === -1 ? sql.length : end + tag.length
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return out
}

function lintMigration(sql: string): string[] {
  const code = stripSql(sql)
  // TEMP/TEMPORARY 테이블은 public 에 생기지 않으므로 대상이 아니다.
  const created = names(
    code,
    String.raw`CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${QNAME}`
  )
  const enabled = new Set(
    names(
      code,
      String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${QNAME}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`
    )
  )
  const errors = created.filter((t) => !enabled.has(t)).map((t) => `RLS 누락: ${t}`)

  // 함수는 생성 시 PUBLIC 에 EXECUTE 가 암묵 부여된다 — 같은 마이그레이션에서 회수해야 한다.
  const REVOKE_EXEC = String.raw`REVOKE\s+(?:EXECUTE|ALL(?:\s+PRIVILEGES)?)\s+ON\s+`
  const revokedAll = new RegExp(
    String.raw`${REVOKE_EXEC}ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+"?public"?\s+FROM\b[^;]*\bPUBLIC\b`,
    'i'
  ).test(code)
  const revoked = new Set(
    names(
      code,
      String.raw`${REVOKE_EXEC}(?:FUNCTION|ROUTINE)\s+${QNAME}[^;]*\bFROM\b[^;]*\bPUBLIC\b`
    )
  )
  if (!revokedAll) {
    names(code, String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+${QNAME}`)
      .filter((f) => !revoked.has(f))
      .forEach((f) => errors.push(`PUBLIC EXECUTE 미회수 함수: ${f}`))
  }

  if (/\bGRANT\b[^;]*\bTO\b[^;]*\b(anon|authenticated|public)\b/i.test(code))
    errors.push('anon/authenticated/PUBLIC GRANT')
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
    expect(lintMigration('GRANT SELECT ON "A" TO anon;')).toEqual([
      'anon/authenticated/PUBLIC GRANT',
    ])
    expect(
      lintMigration('GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated;')
    ).toEqual(['anon/authenticated/PUBLIC GRANT'])
    expect(lintMigration('ALTER TABLE "A" DISABLE ROW LEVEL SECURITY;')).toEqual([
      'DISABLE ROW LEVEL SECURITY',
    ])
  })

  test('PUBLIC 에 GRANT 하면 잡는다', () => {
    expect(lintMigration('GRANT SELECT ON "A" TO PUBLIC;')).toEqual([
      'anon/authenticated/PUBLIC GRANT',
    ])
    expect(lintMigration('GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;')).toEqual([])
  })

  test('PUBLIC EXECUTE 를 회수하지 않은 public 함수를 잡는다', () => {
    expect(
      lintMigration(
        'CREATE OR REPLACE FUNCTION public.f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;'
      )
    ).toEqual(['PUBLIC EXECUTE 미회수 함수: f'])
    expect(
      lintMigration(
        'CREATE FUNCTION "f"() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\nREVOKE EXECUTE ON FUNCTION "f"() FROM PUBLIC;'
      )
    ).toEqual([])
    expect(
      lintMigration(
        'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\nREVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;'
      )
    ).toEqual([])
    expect(
      lintMigration('CREATE FUNCTION auth.f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;')
    ).toEqual([])
  })

  test('UNLOGGED 테이블·대소문자·스키마 한정 이름을 처리한다', () => {
    expect(lintMigration('CREATE UNLOGGED TABLE "A" ("id" TEXT);')).toEqual(['RLS 누락: A'])
    expect(
      lintMigration('CREATE TABLE Foo (id int);\nALTER TABLE "foo" ENABLE ROW LEVEL SECURITY;')
    ).toEqual([])
    expect(
      lintMigration('CREATE TABLE "Foo" (id int);\nALTER TABLE foo ENABLE ROW LEVEL SECURITY;')
    ).toEqual(['RLS 누락: Foo'])
    expect(
      lintMigration(
        'CREATE TABLE "public"."A" (id int);\nALTER TABLE public."A" ENABLE ROW LEVEL SECURITY;'
      )
    ).toEqual([])
    expect(lintMigration('CREATE TABLE storage.x (id int);')).toEqual([])
    expect(lintMigration('CREATE TEMP TABLE t (id int);')).toEqual([])
  })

  // Codex 리뷰 변이 케이스 회귀
  test('문자열·달러 인용 안의 문구는 무시하고, 그 밖의 문장은 잡는다', () => {
    expect(lintMigration('CREATE UNLOGGED TABLE "U" (id int);')).toEqual(['RLS 누락: U'])
    expect(
      lintMigration(
        `CREATE TABLE "A" (id int);\nSELECT 'ALTER TABLE "A" ENABLE ROW LEVEL SECURITY';`
      )
    ).toEqual(['RLS 누락: A'])
    expect(lintMigration(`SELECT '--'; GRANT SELECT ON "User" TO anon;`)).toEqual([
      'anon/authenticated/PUBLIC GRANT',
    ])
    expect(lintMigration(`SELECT 'it''s /*'; GRANT SELECT ON "User" TO anon;`)).toEqual([
      'anon/authenticated/PUBLIC GRANT',
    ])
    expect(lintMigration(`SELECT E'\\' --'; GRANT SELECT ON "User" TO anon;`)).toEqual([
      'anon/authenticated/PUBLIC GRANT',
    ])
    expect(
      lintMigration('DO $body$ BEGIN EXECUTE \'GRANT SELECT ON "A" TO anon\'; END $body$;')
    ).toEqual([])
    expect(lintMigration('SELECT $$ GRANT SELECT ON "A" TO anon; $$;')).toEqual([])
  })

  test('주석 안의 문구는 무시한다', () => {
    expect(lintMigration('-- GRANT SELECT ON "A" TO anon;\n/* CREATE TABLE "B" */')).toEqual([])
    expect(lintMigration('/* a /* b */ GRANT SELECT ON "A" TO anon; */')).toEqual([])
  })
})

test('migrations/ 에는 타임스탬프 디렉터리와 migration_lock.toml 만 있다', () => {
  const unexpected = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => !(e.isDirectory() ? /^\d{14}_/.test(e.name) : e.name === 'migration_lock.toml'))
    .map((e) => e.name)
  expect(unexpected).toEqual([])
})

// 기준(baseline) 목록 = 8a2fdcdd 시점 20261009120000 이전 디렉터리. 부트스트랩은 이 목록만 적용됨으로 표시한다.
// 목록 밖 디렉터리는 타임스탬프와 무관하게 모두 검사한다 — 날짜를 앞당긴 마이그레이션도 빠져나가지 못한다.
const BASELINE = new Set(
  fs
    .readFileSync(path.resolve(process.cwd(), 'scripts/db/baseline-migrations.txt'), 'utf8')
    .split('\n')
    .filter(Boolean)
)
const NEW_DIRS = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((dir) => /^\d{14}_/.test(dir) && !BASELINE.has(dir))

test(`기준 목록 밖 마이그레이션은 ${LOCKDOWN} 이후 타임스탬프를 쓴다`, () => {
  expect(NEW_DIRS.filter((dir) => dir.slice(0, 14) < LOCKDOWN)).toEqual([])
})

test('기준 목록 밖 마이그레이션은 RLS·권한 규칙을 지킨다', () => {
  const violations = NEW_DIRS.map(
    (dir) =>
      [
        dir,
        lintMigration(fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8')),
      ] as const
  ).filter(([, errors]) => errors.length > 0)
  expect(Object.fromEntries(violations)).toEqual({})
})
