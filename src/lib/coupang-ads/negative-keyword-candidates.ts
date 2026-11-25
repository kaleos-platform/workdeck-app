import { prisma } from '@/lib/prisma'
import {
  NEGATIVE_KEYWORD_RULES,
  classifyKeywords,
  kstDateKey,
  negativeKeywordWindow,
  type KeywordAggRow,
  type NegativeKeywordCandidatesResponse,
  type SpendingAfterRemovalKeyword,
} from './negative-keyword-rules'

const DAY_MS = 24 * 60 * 60 * 1000
type Num = number | string | bigint | null

/**
 * 제외 키워드 후보 + 「제거했는데 지출 중」 목록.
 * AdRecord.date / KeywordStatus.removedAt 은 timestamp(3) 무시간대(UTC 저장)라 KST 날짜는
 * `+ interval '9 hours'` 산술로 계산한다(세션 time zone 무관).
 */
export async function getNegativeKeywordCandidates(
  workspaceId: string,
  now = new Date()
): Promise<NegativeKeywordCandidatesResponse> {
  const { end, start30, start90 } = negativeKeywordWindow(now)
  const graceDays = NEGATIVE_KEYWORD_RULES.SPENDING_AFTER_REMOVAL_GRACE_DAYS + 1

  const [aggRaw, statuses, nameRows, metas, spendRaw] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        campaignId: string
        keyword: string
        adCost30: Num
        clicks30: Num
        orders30: Num
        lastSpendDate: string | null
        adCost90: Num
        orders90: Num
        revenue90: Num
      }>
    >`
      SELECT "campaignId", "keyword",
        SUM("adCost") FILTER (WHERE "date" >= ${start30}) AS "adCost30",
        SUM("clicks") FILTER (WHERE "date" >= ${start30}) AS "clicks30",
        SUM(COALESCE("orders14d", "orders1d")) FILTER (WHERE "date" >= ${start30}) AS "orders30",
        to_char(MAX("date") FILTER (WHERE "date" >= ${start30} AND "adCost" > 0) + interval '9 hours', 'YYYY-MM-DD') AS "lastSpendDate",
        SUM("adCost") AS "adCost90",
        SUM(COALESCE("orders14d", "orders1d")) AS "orders90",
        SUM(COALESCE("revenue14d", "revenue1d")) AS "revenue90"
      FROM "AdRecord"
      WHERE "workspaceId" = ${workspaceId}
        AND "keyword" IS NOT NULL AND "keyword" <> ''
        AND "date" >= ${start90} AND "date" < ${end}
      GROUP BY "campaignId", "keyword"
      HAVING SUM("adCost") FILTER (WHERE "date" >= ${start30}) > 0
    `,
    prisma.keywordStatus.findMany({
      where: { workspaceId },
      select: { campaignId: true, keyword: true, removedAt: true, dismissedUntil: true },
    }),
    prisma.$queryRaw<Array<{ campaignId: string; campaignName: string }>>`
      SELECT DISTINCT ON ("campaignId") "campaignId", "campaignName"
      FROM "AdRecord"
      WHERE "workspaceId" = ${workspaceId} AND "date" >= ${start90} AND "date" < ${end}
      ORDER BY "campaignId", "date" DESC
    `,
    prisma.campaignMeta.findMany({
      where: { workspaceId },
      select: { campaignId: true, displayName: true },
    }),
    // 최근 30일 중 제거 표시 후 유예(제거일 KST + 3일 00:00 이후) 지출. 상태는 캠페인 단위라 (campaignId, keyword)로 조인.
    prisma.$queryRaw<
      Array<{
        campaignId: string
        keyword: string
        removedAt: Date
        lastSpendDate: string
        lastSpendAmount: Num
        spendAfterRemoval: Num
      }>
    >`
      SELECT ks."campaignId", ks."keyword", ks."removedAt",
        to_char(MAX(r."date") + interval '9 hours', 'YYYY-MM-DD') AS "lastSpendDate",
        (ARRAY_AGG(r."adCost" ORDER BY r."date" DESC))[1] AS "lastSpendAmount",
        SUM(r."adCost") AS "spendAfterRemoval"
      FROM "KeywordStatus" ks
      JOIN (
        SELECT "campaignId", "keyword", "date", SUM("adCost") AS "adCost"
        FROM "AdRecord"
        WHERE "workspaceId" = ${workspaceId} AND "keyword" IS NOT NULL
          AND "date" >= ${start30} AND "date" < ${end} AND "adCost" > 0
        GROUP BY "campaignId", "keyword", "date"
      ) r ON r."campaignId" = ks."campaignId" AND r."keyword" = ks."keyword"
      WHERE ks."workspaceId" = ${workspaceId} AND ks."removedAt" IS NOT NULL
        AND r."date" >= date_trunc('day', ks."removedAt" + interval '9 hours') - interval '9 hours'
                         + make_interval(days => ${graceDays}::int)
      GROUP BY ks."campaignId", ks."keyword", ks."removedAt"
      ORDER BY MAX(r."date") DESC, SUM(r."adCost") DESC
    `,
  ])

  const names = new Map(nameRows.map((n) => [n.campaignId, n.campaignName]))
  for (const m of metas) names.set(m.campaignId, m.displayName)

  const rows: KeywordAggRow[] = aggRaw.map((r) => ({
    campaignId: r.campaignId,
    keyword: r.keyword,
    adCost30: Number(r.adCost30 ?? 0),
    clicks30: Number(r.clicks30 ?? 0),
    orders30: Number(r.orders30 ?? 0),
    lastSpendDate: r.lastSpendDate,
    adCost90: Number(r.adCost90 ?? 0),
    orders90: Number(r.orders90 ?? 0),
    revenue90: Number(r.revenue90 ?? 0),
  }))

  const spendingAfterRemoval: SpendingAfterRemovalKeyword[] = spendRaw.map((r) => ({
    campaignId: r.campaignId,
    campaignName: names.get(r.campaignId) ?? r.campaignId,
    keyword: r.keyword,
    removedAt: r.removedAt.toISOString(),
    lastSpendDate: r.lastSpendDate,
    lastSpendAmount: Number(r.lastSpendAmount ?? 0),
    spendAfterRemoval: Number(r.spendAfterRemoval ?? 0),
  }))

  return {
    rules: NEGATIVE_KEYWORD_RULES,
    period: { start: kstDateKey(start30), end: kstDateKey(new Date(end.getTime() - DAY_MS)) },
    campaigns: classifyKeywords(rows, statuses, names, now),
    spendingAfterRemoval,
  }
}
