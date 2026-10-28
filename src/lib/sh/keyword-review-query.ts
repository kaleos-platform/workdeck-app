// 주간 키워드 리뷰 로더 — 광고 검색어 데이터가 있는 대상(채널상품/단독 리스팅)별 발굴·정리 후보.
// 대상별 계산은 loadAdKeywordPerformance 를 재사용한다(대상 수십 개 가정, 상한 있음).
import { prisma } from '@/lib/prisma'
import { toKeywordList } from '@/lib/sh/keyword-change'
import { loadAdKeywordPerformance } from '@/lib/sh/ad-keyword-performance-query'
import { suppressRejected } from '@/lib/sh/keyword-review'
import { MAX_KEYWORDS } from '@/lib/sh/schemas'

export const KEYWORD_ACTION_TYPE = 'seller-hub.keywords.update'
const DAY_MS = 86_400_000
const WINDOW_DAYS = 30
const SUPPRESS_DAYS = 90
const DISCOVER_TOP = 10
// 변경 후 14일은 효과 측정 구간 — 그 사이 또 바꾸면 전후 비교가 무너진다.
export const MEASURE_DAYS = 14
// date 컬럼은 KST 자정(= 전날 15:00 UTC)으로 저장된다 — ad-keyword-performance-query 와 동일.
const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)

type Payload = {
  target?: { channelProductId?: string; listingId?: string }
  add?: string[]
  remove?: string[]
}
export const targetIdOf = (p: Payload) => p.target?.channelProductId ?? p.target?.listingId ?? null

/** 대상별 마지막 상품명·키워드 변경 시각. 채널상품은 channelProductId, 단독 리스팅은 listingId 로 기록된다. */
export async function lastChangeAt(
  spaceId: string,
  targets: { kind: 'channelProduct' | 'listing'; id: string }[]
): Promise<Map<string, Date>> {
  const cpIds = targets.filter((t) => t.kind === 'channelProduct').map((t) => t.id)
  const lIds = targets.filter((t) => t.kind === 'listing').map((t) => t.id)
  const [byCp, byListing] = await Promise.all([
    cpIds.length
      ? prisma.keywordChangeLog.groupBy({
          by: ['channelProductId'],
          where: { spaceId, channelProductId: { in: cpIds } },
          _max: { createdAt: true },
        })
      : [],
    lIds.length
      ? prisma.keywordChangeLog.groupBy({
          by: ['listingId'],
          where: { spaceId, listingId: { in: lIds } },
          _max: { createdAt: true },
        })
      : [],
  ])
  const out = new Map<string, Date>()
  for (const g of byCp)
    if (g.channelProductId && g._max.createdAt) out.set(g.channelProductId, g._max.createdAt)
  for (const g of byListing)
    if (g.listingId && g._max.createdAt) out.set(g.listingId, g._max.createdAt)
  return out
}

export const isMeasuring = (at: Date | undefined, now = Date.now()) =>
  Boolean(at && now - at.getTime() < MEASURE_DAYS * DAY_MS)

export async function loadKeywordReview(
  spaceId: string,
  opts: { limit?: number; targetId?: string } = {}
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50)
  const workspace = await prisma.workspace.findUnique({ where: { spaceId }, select: { id: true } })
  if (!workspace) return { window: null, targets: [] }
  const latest = await prisma.adRecord.aggregate({
    where: { workspaceId: workspace.id, keyword: { not: null } },
    _max: { date: true },
  })
  const to = latest._max.date
  if (!to) return { window: null, targets: [] }
  const from = new Date(to.getTime() - (WINDOW_DAYS - 1) * DAY_MS)

  // 1. 기간 내 검색어 광고가 있는 옵션ID → 합계
  const byOption = await prisma.adRecord.groupBy({
    by: ['optionId'],
    where: { workspaceId: workspace.id, keyword: { not: null }, date: { gte: from, lte: to } },
    _sum: { impressions: true, orders1d: true, adCost: true },
  })
  const adOf = new Map(
    byOption.map((g) => [
      g.optionId,
      {
        impressions: g._sum.impressions ?? 0,
        orders: g._sum.orders1d ?? 0,
        adCost: Number(g._sum.adCost ?? 0),
      },
    ])
  )
  const optionIds = [...adOf.keys()].filter(Boolean) as string[]
  if (optionIds.length === 0) return { window: null, targets: [] }

  // 2. 옵션 → sellerProductId → (같은 sellerProductId 의) 연결 리스팅
  const hit = await prisma.coupangProductItem.findMany({
    where: {
      spaceId,
      OR: [{ rgVendorItemId: { in: optionIds } }, { mpVendorItemId: { in: optionIds } }],
    },
    select: { sellerProductId: true },
  })
  const sellerProductIds = [...new Set(hit.map((i) => i.sellerProductId))]
  const items = await prisma.coupangProductItem.findMany({
    where: { spaceId, sellerProductId: { in: sellerProductIds } },
    select: {
      sellerProductId: true,
      rgVendorItemId: true,
      mpVendorItemId: true,
      listing: {
        select: {
          id: true,
          searchName: true,
          keywords: true,
          channel: { select: { name: true } },
          channelProduct: {
            select: {
              id: true,
              baseSearchName: true,
              keywords: true,
              channel: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  type T = {
    kind: 'channelProduct' | 'listing'
    id: string
    name: string
    channel: string
    keywordCount: number
    optionIds: Set<string>
    spIds: Set<string>
  }
  const targets = new Map<string, T>()
  // sellerProductId → 연결 리스팅이 속한 대상들. 미연결 아이템도 같은 sellerProductId 면 그 대상에 귀속한다
  // (loadAdKeywordPerformance 와 같은 귀속).
  const targetsOfSp = new Map<string, T[]>()
  for (const it of items) {
    const l = it.listing
    if (!l) continue
    const cp = l.channelProduct
    const key = cp ? cp.id : l.id
    let t = targets.get(key)
    if (!t) {
      t = {
        kind: cp ? 'channelProduct' : 'listing',
        id: key,
        name: cp ? cp.baseSearchName : l.searchName,
        channel: (cp ? cp.channel.name : l.channel.name) ?? '',
        keywordCount: toKeywordList(cp ? cp.keywords : l.keywords).length,
        optionIds: new Set(),
        spIds: new Set(),
      }
      targets.set(key, t)
    }
    t.spIds.add(it.sellerProductId)
    const list = targetsOfSp.get(it.sellerProductId) ?? []
    if (!list.includes(t)) list.push(t)
    targetsOfSp.set(it.sellerProductId, list)
  }
  // 같은 옵션은 Set 이라 한 번만 센다.
  for (const it of items) {
    for (const t of targetsOfSp.get(it.sellerProductId) ?? []) {
      for (const o of [it.rgVendorItemId, it.mpVendorItemId]) if (o) t.optionIds.add(o)
    }
  }

  const sums = [...targets.values()]
    .filter((t) => !opts.targetId || t.id === opts.targetId)
    .map((t) => {
      let impressions = 0
      let orders = 0
      let adCost = 0
      for (const o of t.optionIds) {
        const a = adOf.get(o)
        if (!a) continue
        impressions += a.impressions
        orders += a.orders
        adCost += a.adCost
      }
      return { t, ad: { impressions, orders, adCost } }
    })
    .filter((x) => x.ad.impressions > 0 || x.ad.orders > 0 || x.ad.adCost > 0)
    .sort((a, b) => b.ad.orders - a.ad.orders)
    .slice(0, limit)

  // 3. 제안 이력(대기·최근 거절) — 한 번에 읽어 대상별로 나눈다.
  const history = await prisma.agentPendingAction.findMany({
    where: {
      spaceId,
      actionType: KEYWORD_ACTION_TYPE,
      OR: [
        { status: 'PENDING', expiresAt: { gt: new Date() } },
        { status: 'REJECTED', decidedAt: { gte: new Date(Date.now() - SUPPRESS_DAYS * DAY_MS) } },
      ],
    },
    select: { id: true, status: true, payload: true },
  })

  const changed = await lastChangeAt(
    spaceId,
    sums.map(({ t }) => t)
  )
  const out = []
  for (const { t, ad } of sums) {
    const perf = await loadAdKeywordPerformance(
      spaceId,
      t.kind === 'channelProduct' ? { channelProductId: t.id } : { listingId: t.id }
    )
    if (!perf) continue
    const mine = history.filter((h) => targetIdOf(h.payload as Payload) === t.id)
    const rejected = mine.filter((h) => h.status === 'REJECTED').map((h) => h.payload as Payload)
    const d = suppressRejected(
      perf.discover,
      (w) => w.word,
      rejected.flatMap((p) => p.add ?? [])
    )
    const p = suppressRejected(
      perf.prune,
      (w) => w,
      rejected.flatMap((r) => r.remove ?? [])
    )
    out.push({
      target: { kind: t.kind, id: t.id, name: t.name, channel: t.channel },
      ad,
      keywordCount: t.keywordCount,
      keywordLimit: MAX_KEYWORDS,
      discover: d.kept.slice(0, DISCOVER_TOP),
      prune: p.kept,
      suppressed: [...d.suppressed, ...p.suppressed],
      pendingProposal: mine.find((h) => h.status === 'PENDING')?.id ?? null,
      lastChangeAt: changed.get(t.id)?.toISOString() ?? null,
      // true 면 효과 측정 중 — 제안하지 않는다(액션도 거부한다).
      measuring: isMeasuring(changed.get(t.id)),
    })
  }
  return { window: { from: kstDate(from), to: kstDate(to) }, targets: out }
}
