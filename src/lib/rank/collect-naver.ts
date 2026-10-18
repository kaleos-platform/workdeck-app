// 네이버 쇼핑 순위 일일 수집 코어 — 크론 라우트와 e2e 가 공유한다.
//
// 재실행해도 안전하다: 오늘 이미 행이 있는 (대상, 키워드)는 건너뛰므로 시간 제한으로 끊긴 실행을
// 다음 크론이 이어받는다. 조회 실패·매칭 불가를 "100위 밖"으로 적지 않는 것이 핵심 규칙이다.

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { formatDateToYmdKst } from '@/lib/date-range'
import { toKeywordList } from '@/lib/sh/keyword-change'
import {
  matchNaverRank,
  rankSourceForUrl,
  searchNaverShopping,
  type NaverSearchResult,
} from '@/lib/rank/naver-shopping'

export type CollectNaverOpts = {
  now?: Date
  deadlineMs: number // Date.now() 기준 절대 시각
  dailyBudget: number // 하루 API 호출 상한
  slotLimit: number // Space 당 (대상, 키워드) 상한
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
}

export type CollectNaverSummary = {
  date: string
  targets: number
  calls: number
  ranked: number
  notInTop: number
  failed: number
  skipped: number
  budgetExhausted: boolean
  timedOut: boolean
  /** 연속 호출 실패로 이번 실행을 멈췄는가(다음 크론이 이어받는다) */
  aborted: boolean
}

type Target = {
  spaceId: string
  targetKey: string
  channelProductId: string | null
  listingId: string | null
  pageUrl: string
  updatedAt: Date
  keywords: string[]
}

const MAX_CONSECUTIVE_FAILS = 3
const BATCH = 200

export async function collectNaverRanks(opts: CollectNaverOpts): Promise<CollectNaverSummary> {
  const ymd = formatDateToYmdKst(opts.now ?? new Date())
  const date = new Date(`${ymd}T00:00:00Z`) // @db.Date 컬럼 — UTC 자정으로 KST 일자를 저장
  const summary: CollectNaverSummary = {
    date: ymd,
    targets: 0,
    calls: 0,
    ranked: 0,
    notInTop: 0,
    failed: 0,
    skipped: 0,
    budgetExhausted: false,
    timedOut: false,
    aborted: false,
  }

  const [cps, listings] = await Promise.all([
    prisma.channelProduct.findMany({
      where: { rankTracking: true, pageUrl: { not: null } },
      select: { id: true, spaceId: true, pageUrl: true, keywords: true, updatedAt: true },
    }),
    prisma.productListing.findMany({
      where: { rankTracking: true, channelProductId: null, pageUrl: { not: null } },
      select: { id: true, spaceId: true, pageUrl: true, keywords: true, updatedAt: true },
    }),
  ])
  const targets: Target[] = [
    ...cps.map((t) => ({ ...t, targetKey: `cp:${t.id}`, channelProductId: t.id, listingId: null })),
    ...listings.map((t) => ({
      ...t,
      targetKey: `ls:${t.id}`,
      channelProductId: null,
      listingId: t.id,
    })),
  ]
    .filter((t) => t.pageUrl && rankSourceForUrl(t.pageUrl) === 'NAVER_SHOPPING')
    .map((t) => ({
      spaceId: t.spaceId,
      targetKey: t.targetKey,
      channelProductId: t.channelProductId,
      listingId: t.listingId,
      pageUrl: t.pageUrl as string,
      updatedAt: t.updatedAt,
      keywords: [...new Set(toKeywordList(t.keywords))],
    }))
  summary.targets = targets.length

  // 오늘 이미 있는 행 — 이어받기 + 예산 계산
  const todayRows = await prisma.keywordRankSnapshot.findMany({
    where: { source: 'NAVER_SHOPPING', date },
    select: { targetKey: true, keyword: true, status: true },
  })
  // FAILED 는 끝난 것으로 보지 않는다 — 일시 오류(429·5xx)를 같은 날 다음 크론이 다시 시도한다.
  const done = new Set(
    todayRows.filter((r) => r.status !== 'FAILED').map((r) => `${r.targetKey}\u0000${r.keyword}`)
  )
  const failedKeywords = new Set(
    todayRows.filter((r) => r.status === 'FAILED').map((r) => r.keyword)
  )
  // 오늘 호출 수 근사: 호출이 있었던 상태(RANKED/NOT_IN_TOP100/FAILED) 행의 서로 다른 키워드 수.
  // 키워드 하나가 한 번 호출되어 여러 대상에 쓰이므로 정확한 호출 수와 거의 같다.
  const calledToday = new Set(todayRows.filter((r) => r.status !== 'SKIPPED').map((r) => r.keyword))
  const callBudget = () => opts.dailyBudget - calledToday.size

  // Space 별 슬롯 — 오래 수정되지 않은 대상부터 채워 한도 초과분이 새 대상에 몰리게 한다.
  type Pair = { target: Target; keyword: string; overSlot: boolean }
  const pairs: Pair[] = []
  const bySpace = new Map<string, Target[]>()
  for (const t of targets) bySpace.set(t.spaceId, [...(bySpace.get(t.spaceId) ?? []), t])
  for (const list of bySpace.values()) {
    list.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    let n = 0
    for (const target of list)
      for (const keyword of target.keywords)
        pairs.push({ target, keyword, overSlot: ++n > opts.slotLimit })
  }

  const buffer: Prisma.KeywordRankSnapshotCreateManyInput[] = []
  const flush = async (force = false) => {
    while (buffer.length >= BATCH || (force && buffer.length > 0)) {
      await prisma.keywordRankSnapshot.createMany({
        data: buffer.splice(0, BATCH),
        skipDuplicates: true,
      })
    }
  }
  const push = (
    p: Pair,
    status: 'RANKED' | 'NOT_IN_TOP100' | 'FAILED' | 'SKIPPED',
    extra: { rank?: number; errorCode?: string } = {}
  ) => {
    buffer.push({
      spaceId: p.target.spaceId,
      targetKey: p.target.targetKey,
      channelProductId: p.target.channelProductId,
      listingId: p.target.listingId,
      source: 'NAVER_SHOPPING',
      keyword: p.keyword,
      date,
      status,
      rank: extra.rank ?? null,
      adShown: false,
      errorCode: extra.errorCode ?? null,
    })
    if (status === 'RANKED') summary.ranked++
    else if (status === 'NOT_IN_TOP100') summary.notInTop++
    else if (status === 'FAILED') summary.failed++
    else summary.skipped++
  }

  // ponytail: 키워드 호출을 직렬로 한다(네이버 초당 10건 제한 안전). 처리량이 모자라면 동시성 3~5 로.
  const cache = new Map<string, NaverSearchResult>()
  let consecutiveFails = 0
  for (const p of pairs) {
    if (done.has(`${p.target.targetKey}\u0000${p.keyword}`)) continue
    if (p.overSlot) {
      push(p, 'SKIPPED', { errorCode: 'SLOT_LIMIT' })
      continue
    }
    let res = cache.get(p.keyword)
    if (!res) {
      if (Date.now() > opts.deadlineMs) {
        summary.timedOut = true
        break
      }
      if (callBudget() <= 0) {
        summary.budgetExhausted = true
        push(p, 'SKIPPED', { errorCode: 'BUDGET' })
        continue
      }
      // 같은 날 앞서 실패한 키워드를 다시 부르면 그 FAILED 행을 지우고 새 결과로 바꾼다(unique 때문에).
      if (failedKeywords.has(p.keyword)) {
        await prisma.keywordRankSnapshot.deleteMany({
          where: { source: 'NAVER_SHOPPING', date, keyword: p.keyword, status: 'FAILED' },
        })
        failedKeywords.delete(p.keyword)
      }
      res = await searchNaverShopping(p.keyword, opts)
      cache.set(p.keyword, res)
      calledToday.add(p.keyword)
      summary.calls++
      consecutiveFails = res.ok ? 0 : consecutiveFails + 1
      // 연속 실패면 한도·장애다 — 남은 키워드를 계속 두드려 전부 FAILED 로 만들지 않고 멈춘다.
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        push(p, 'FAILED', { errorCode: res.ok ? undefined : res.errorCode })
        summary.aborted = true
        break
      }
    }
    if (!res.ok) {
      push(p, 'FAILED', { errorCode: res.errorCode })
      continue
    }
    const m = matchNaverRank(res.items, p.target.pageUrl)
    if ('unmatchable' in m) push(p, 'SKIPPED', { errorCode: 'UNMATCHABLE_URL' })
    else if (m.found) push(p, 'RANKED', { rank: m.rank })
    else push(p, 'NOT_IN_TOP100')
    await flush()
  }
  await flush(true)
  return summary
}
