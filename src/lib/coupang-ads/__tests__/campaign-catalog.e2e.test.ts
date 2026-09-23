/** @jest-environment node */
import { Client } from 'pg'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    adRecord: { groupBy: jest.fn() },
    campaignMeta: { findMany: jest.fn(async () => []) },
    campaignTarget: { findMany: jest.fn(async () => []) },
  },
}))
jest.mock('next/cache', () => ({ unstable_cache: (loader: () => unknown) => loader }))

import { prisma } from '@/lib/prisma'
import { queryCampaignNavigation, queryCampaigns } from '../queries'

// 전용 개발 DB URL을 명시해야 실행한다. 데이터는 연결 전용 임시 테이블에만 생성한다.
const connectionString = process.env.COUPANG_ADS_TEST_DATABASE_URL
const suite = connectionString ? describe : describe.skip
suite('실제 PostgreSQL 캠페인 목록 조회', () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  let sql: string
  let params: unknown[]

  beforeAll(async () => {
    await client.connect()
    await client.query(`CREATE TEMP TABLE "AdRecord" (
      "workspaceId" text, "campaignId" text, "adType" text,
      "campaignName" text, date timestamp
    )`)
    await client.query(`INSERT INTO "AdRecord"
      SELECT 'test', 'c' || (n % 3), CASE WHEN n % 2 = 0 THEN 'A' ELSE 'B' END,
        CASE WHEN n < 100000 THEN '이전 이름' ELSE 'name-' || (n % 3) || '-' || (n % 2) END,
        timestamp '2026-01-01' + n * interval '1 second'
      FROM generate_series(1, 150000) n`)
    await client.query(`INSERT INTO "AdRecord" VALUES
      ('other', 'c0', 'A', '다른 workspace', '2030-01-01')`)
    await client.query('CREATE INDEX ON "AdRecord" ("workspaceId", "campaignId", date)')
    await client.query('CREATE INDEX ON "AdRecord" ("workspaceId", date, "campaignId", "adType")')
    await client.query('CREATE INDEX ON "AdRecord" ("workspaceId", "campaignId", "adType", date)')
    await client.query('ANALYZE "AdRecord"')
    // 기존 Prisma 집계도 같은 연결의 임시 데이터에서 실행해 전후 계획을 비교한다.
    jest.mocked(prisma.adRecord.groupBy).mockImplementation((async (args: {
      where: { workspaceId: string }
    }) => {
      sql = `SELECT "campaignId", min(date) AS "minDate", max(date) AS "maxDate"
        FROM "AdRecord" WHERE "workspaceId" = $1 GROUP BY "campaignId"`
      params = [args.where.workspaceId]
      return (await client.query(sql, params)).rows.map((row) => ({
        campaignId: row.campaignId,
        _min: { date: row.minDate },
        _max: { date: row.maxDate },
      }))
    }) as never)
    jest.mocked(prisma.$queryRaw).mockImplementation((async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      sql = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '')
      params = values
      return (await client.query(sql, params)).rows
    }) as never)
  })
  afterAll(async () => {
    await client.end()
  })

  test('workspace와 최신 이름·광고유형 순서를 보존하며 원본 전체 정렬을 피한다', async () => {
    const result = await queryCampaignNavigation('test')
    expect(result.map(({ id, name, adTypes }) => ({ id, name, adTypes }))).toEqual(
      [0, 1, 2].map((id) => ({ id: `c${id}`, name: `name-${id}-0`, adTypes: ['A', 'B'] }))
    )
    const plan = (await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params)).rows[0][
      'QUERY PLAN'
    ][0].Plan
    const sortRows: number[] = []
    let scannedRows = 0
    const visit = (node: Record<string, unknown>) => {
      if (node['Node Type'] === 'Sort') sortRows.push(Number(node['Actual Rows']))
      if (String(node['Node Type']).includes('Scan') && node['Relation Name'] === 'AdRecord') {
        scannedRows += Number(node['Actual Rows']) * Number(node['Actual Loops'])
      }
      for (const child of (node.Plans ?? []) as Record<string, unknown>[]) visit(child)
    }
    visit(plan)
    expect(Math.max(0, ...sortRows)).toBeLessThan(1000)
    // 캠페인·광고유형 6개를 찾으려고 15만 원본 행을 모두 읽지 않아야 한다.
    expect(scannedRows).toBeLessThan(1000)
  })

  test('광고가 없는 workspace는 빈 목록을 반환한다', async () => {
    expect(await queryCampaignNavigation('empty')).toEqual([])
    expect(await queryCampaigns('empty')).toEqual([])
  })

  test('전체 날짜 범위는 다른 workspace를 제외하고 인덱스 양 끝에서 읽는다', async () => {
    const result = await queryCampaigns('test')
    expect(result.map(({ id, minDate, maxDate }) => ({ id, minDate, maxDate }))).toEqual(
      [0, 1, 2].map((id) => ({ id: `c${id}`, minDate: '2026-01-01', maxDate: '2026-01-02' }))
    )
    const plan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params))
      .rows[0]['QUERY PLAN'][0].Plan
    // 실행시간 대신 데이터 접근량으로 회귀를 잡아 원격 DB 변동의 영향을 피한다.
    expect(Number(plan['Local Hit Blocks']) + Number(plan['Local Read Blocks'])).toBeLessThan(1000)
  })
})
