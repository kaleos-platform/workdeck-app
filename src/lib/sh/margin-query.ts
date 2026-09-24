/**
 * SKU/옵션 단위 공헌이익 집계.
 *
 *   contributionProfit      = revenue - cogs - shippingCost - packagingCost - commissionFee - adCost
 *   contributionMarginRatio = contributionProfit / revenue      (revenue = 0 이면 null)
 *
 * 설계 원칙 — 귀속에 실패한 금액을 옵션에 흩뿌리지 않는다.
 * 실패분은 추정 배분하지 않고 unattributedRevenue / unallocatedAdCost 로 분리하며
 * coverage 를 함께 낸다.
 *
 * **매출·수량은 loadProductSales 단일 소스다**(직접배송 + 로켓그로스).
 * 판매분석 상품 랭킹과 같은 함수를 쓰므로 두 화면의 숫자가 구조적으로 일치한다.
 * 예전에는 이 파일이 자체 귀속 로직을 따로 갖고 있었고, DelOrderItemFulfillment 를
 * 조회하지 않아 **직배송 매출의 59%(90일 4,167만원)를 미매칭으로 버렸다**.
 * 비용(원가·수수료·배송비·포장비)과 광고비 귀속만 이 파일의 책임으로 남긴다.
 */

import { prisma } from '@/lib/prisma'
import { costExVat } from '@/lib/sh/cost'
import { lookupCategoryFeePct, DEFAULT_FEE_CATEGORY } from '@/lib/sh/channel-fee-lookup'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { loadExternalOptionBridge } from '@/lib/sh/external-option-bridge'
import { loadProductSales } from '@/lib/sh/product-sales'

export interface QueryProductMarginParams {
  from: string // YYYY-MM-DD (KST)
  to: string // YYYY-MM-DD (KST, 포함)
  productIds?: string[] | null
  optionIds?: string[] | null
  /** 채널명 또는 채널ID. 지정 시 해당 채널 매출만 집계. */
  channel?: string | null
  page?: number | null
  pageSize?: number | null
}

type Accum = {
  revenue: number
  quantity: number
  adCost: number
  commissionFee: number
  shippingCost: number
}

const zero = (): Accum => ({
  revenue: 0,
  quantity: 0,
  adCost: 0,
  commissionFee: 0,
  shippingCost: 0,
})

/** KST 일자 문자열 → UTC instant 범위 [gte, lt) */
function kstRange(from: string, to: string): { gte: Date; lt: Date } {
  const gte = new Date(`${from}T00:00:00+09:00`)
  const lt = new Date(`${to}T00:00:00+09:00`)
  lt.setTime(lt.getTime() + 24 * 60 * 60 * 1000) // to 일자 포함
  return { gte, lt }
}

export async function queryProductMargin(spaceId: string, params: QueryProductMarginParams) {
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? 50)))
  const { gte, lt } = kstRange(params.from, params.to)
  const missingFields: string[] = []

  // ── 대상 옵션 유니버스 ────────────────────────────────────────────────
  const optionWhere = {
    deletedAt: null,
    ...(params.optionIds?.length ? { id: { in: params.optionIds } } : {}),
    product: {
      spaceId,
      ...(params.productIds?.length ? { id: { in: params.productIds } } : {}),
    },
  }
  const options = await prisma.invProductOption.findMany({
    where: optionWhere,
    select: {
      id: true,
      name: true,
      sku: true,
      costPrice: true,
      costVatIncluded: true,
      product: { select: { id: true, name: true, internalName: true } },
    },
  })
  const optionIdSet = new Set(options.map((o) => o.id))
  const optionById = new Map(options.map((o) => [o.id, o]))

  // ── 채널 (수수료·배송비 계수) ─────────────────────────────────────────
  const channels = await prisma.channel.findMany({
    where: { spaceId },
    select: {
      id: true,
      name: true,
      externalSource: true,
      shippingFeeType: true,
      shippingFee: true,
      shippingFeePct: true,
      vatIncludedInFee: true,
      feeRates: { select: { categoryName: true, ratePercent: true } },
    },
  })
  const channelById = new Map(channels.map((c) => [c.id, c]))
  const channelFilter = params.channel?.trim() || null
  const matchesChannel = (chId: string | null): boolean => {
    if (!channelFilter) return true
    if (!chId) return false
    const c = channelById.get(chId)
    return chId === channelFilter || c?.name === channelFilter
  }

  const feePctOf = (chId: string | null): number => {
    const c = chId ? channelById.get(chId) : undefined
    if (!c) return 0
    return lookupCategoryFeePct(
      c.feeRates.map((f) => ({ categoryName: f.categoryName, ratePercent: Number(f.ratePercent) })),
      DEFAULT_FEE_CATEGORY
    )
  }
  /**
   * 배송비 — PERCENT 채널만 행 단위로 계산한다.
   *
   * FIXED 는 **주문 1건당** 부과지 상품 개당이 아니다. 예전엔 `shippingFee × 수량` 이라
   * 수량이 많을수록 배송비가 선형으로 불어났다(90일 기준 매출의 19%). FIXED 는 아래에서
   * 채널별 주문 건수 × 배송비를 구해 매출 비중으로 배분한다.
   *
   * 로켓그로스는 쿠팡이 배송하므로 판매자 배송비가 없다 — 채널 설정값과 무관하게 0.
   */
  const percentShippingOf = (chId: string | null, revenue: number): number => {
    const c = chId ? channelById.get(chId) : undefined
    if (!c || c.externalSource) return 0
    if (c.shippingFeeType !== 'PERCENT') return 0
    return revenue * Number(c.shippingFeePct ?? 0)
  }

  const acc = new Map<string, Accum>()
  const bump = (optionId: string, patch: Partial<Accum>) => {
    const cur = acc.get(optionId) ?? zero()
    cur.revenue += patch.revenue ?? 0
    cur.quantity += patch.quantity ?? 0
    cur.adCost += patch.adCost ?? 0
    cur.commissionFee += patch.commissionFee ?? 0
    cur.shippingCost += patch.shippingCost ?? 0
    acc.set(optionId, cur)
  }

  // ── 1) 매출·수량 — loadProductSales 단일 소스 (직배송 + 로켓) ─────────
  // 귀속 로직을 여기서 다시 구현하지 않는다. 과거에 그렇게 했다가 fulfillment 경로를
  // 빠뜨려 직배송 매출의 59% 를 잃었다.
  const salesChannels = channels
    .filter((c) => matchesChannel(c.id))
    .map((c) => ({ id: c.id, name: c.name, externalSource: c.externalSource }))

  const sales = await loadProductSales(spaceId, gte, new Date(lt.getTime() - 1), salesChannels)

  // 조회 대상 옵션 유니버스(파라미터 필터 적용) 밖의 매출은 이 조회의 관심사가 아니므로
  // 귀속으로 세지 않고 별도로 모은다.
  let outOfScopeRevenue = 0
  // FIXED 배송비 배분용: 채널 → (옵션 → 매출)
  const fixedShipRevenueByChannel = new Map<string, Map<string, number>>()
  for (const row of sales.rows) {
    if (!optionIdSet.has(row.optionId)) {
      outOfScopeRevenue += row.revenue
      continue
    }
    bump(row.optionId, {
      revenue: row.revenue,
      quantity: row.quantity,
      commissionFee: row.revenue * feePctOf(row.channelId),
      shippingCost: percentShippingOf(row.channelId, row.revenue),
    })
    const ch = channelById.get(row.channelId)
    if (ch && !ch.externalSource && ch.shippingFeeType === 'FIXED') {
      const cur = fixedShipRevenueByChannel.get(row.channelId) ?? new Map<string, number>()
      cur.set(row.optionId, (cur.get(row.optionId) ?? 0) + row.revenue)
      fixedShipRevenueByChannel.set(row.channelId, cur)
    }
  }

  // ── 배송비(FIXED) — 채널별 주문 건수 × 배송비를 매출 비중으로 배분 ────
  const fixedShipChannelIds = [...fixedShipRevenueByChannel.keys()]
  if (fixedShipChannelIds.length > 0) {
    const orderCounts = await prisma.delOrder.groupBy({
      by: ['channelId'],
      where: { spaceId, channelId: { in: fixedShipChannelIds }, orderDate: { gte, lt } },
      _count: { _all: true },
    })
    for (const oc of orderCounts) {
      if (!oc.channelId) continue
      const fee = Number(channelById.get(oc.channelId)?.shippingFee ?? 0)
      const total = fee * oc._count._all
      if (total === 0) continue
      const byOption = fixedShipRevenueByChannel.get(oc.channelId)
      if (!byOption || byOption.size === 0) continue
      const revSum = [...byOption.values()].reduce((a, v) => a + v, 0)
      for (const [optionId, rev] of byOption) {
        const share = revSum > 0 ? rev / revSum : 1 / byOption.size
        bump(optionId, { shippingCost: total * share })
      }
    }
  }

  const directRevenueTotal = sales.coverage.direct.revenueTotal
  const directRevenueAttributed = sales.coverage.direct.revenueAttributed
  const directLines = sales.coverage.direct.lines
  const directLinesAttributed = sales.coverage.direct.linesAttributed

  // ── 2) 로켓그로스 매출 + 3) 광고비 ────────────────────────────────────
  const coupang = await resolveCoupangWorkspaceForSpace(spaceId)
  const bridge = coupang
    ? await loadExternalOptionBridge(spaceId, coupang.workspaceId)
    : { byExternalOptionId: new Map(), stats: { dictEntries: 0, bridgedExternalOptions: 0 } }

  // 로켓 매출은 위 loadProductSales 에 이미 포함돼 있다(채널 id 도 실제 로켓 채널).
  // 여기서 다시 집계하면 이중 계상된다. 브리지는 광고비 귀속에만 쓴다.
  const rocketRevenueTotal = sales.coverage.rocket.revenueTotal
  const rocketRevenueAttributed = sales.coverage.rocket.revenueAttributed
  let adCostTotal = 0
  let adCostAttributedByBridge = 0
  let adCostAttributedByCampaignMap = 0

  if (coupang) {
    // 3) 광고비 — 1단계: 외부 옵션 브리지
    const adRows = await prisma.adRecord.groupBy({
      by: ['campaignId', 'optionId'],
      where: { workspaceId: coupang.workspaceId, date: { gte, lt } },
      _sum: { adCost: true },
    })
    adCostTotal = adRows.reduce((s, r) => s + Number(r._sum.adCost ?? 0), 0)

    const leftoverByCampaign = new Map<string, number>()
    for (const r of adRows) {
      const amount = Number(r._sum.adCost ?? 0)
      if (amount === 0) continue
      const alloc = r.optionId ? bridge.byExternalOptionId.get(r.optionId) : undefined
      if (alloc && alloc.length > 0) {
        let landed = 0
        for (const a of alloc) {
          if (!optionIdSet.has(a.optionId)) continue
          const part = amount * a.weight
          bump(a.optionId, { adCost: part })
          landed += part
        }
        adCostAttributedByBridge += landed
        // 유니버스 밖 옵션으로 간 몫은 이 조회 대상이 아니므로 잔여로 넘기지 않는다.
        continue
      }
      leftoverByCampaign.set(r.campaignId, (leftoverByCampaign.get(r.campaignId) ?? 0) + amount)
    }

    // 3) 광고비 — 2단계: 캠페인↔상품 매핑. 상품 내 옵션 배분은 기간 매출 비례.
    if (leftoverByCampaign.size > 0) {
      const maps = await prisma.adCampaignProductMap.findMany({
        where: { spaceId, campaignId: { in: [...leftoverByCampaign.keys()] } },
        select: { campaignId: true, productId: true },
      })
      const productsByCampaign = new Map<string, string[]>()
      for (const m of maps) {
        const arr = productsByCampaign.get(m.campaignId) ?? []
        arr.push(m.productId)
        productsByCampaign.set(m.campaignId, arr)
      }

      // 상품별 (옵션 → 현재까지 집계된 매출) 인덱스
      const revenueByProduct = new Map<string, { optionId: string; revenue: number }[]>()
      for (const [optionId, a] of acc) {
        const opt = optionById.get(optionId)
        if (!opt) continue
        const arr = revenueByProduct.get(opt.product.id) ?? []
        arr.push({ optionId, revenue: a.revenue })
        revenueByProduct.set(opt.product.id, arr)
      }

      for (const [campaignId, amount] of leftoverByCampaign) {
        const productIds = productsByCampaign.get(campaignId)
        if (!productIds || productIds.length === 0) continue // → unallocated

        // 캠페인 광고비를 상품들의 매출 비중으로 먼저 나눈다.
        const productRevenues = productIds.map((pid) => ({
          pid,
          revenue: (revenueByProduct.get(pid) ?? []).reduce((s, x) => s + x.revenue, 0),
        }))
        const totalRev = productRevenues.reduce((s, p) => s + p.revenue, 0)

        for (const { pid, revenue } of productRevenues) {
          const productShare =
            totalRev > 0 ? revenue / totalRev : 1 / Math.max(1, productRevenues.length)
          const productAd = amount * productShare
          const optRows = revenueByProduct.get(pid) ?? []
          const optTotal = optRows.reduce((s, x) => s + x.revenue, 0)
          if (optRows.length === 0) continue // 매출 근거 없는 상품 → unallocated 로 남음

          for (const row of optRows) {
            const optShare = optTotal > 0 ? row.revenue / optTotal : 1 / optRows.length
            const part = productAd * optShare
            bump(row.optionId, { adCost: part })
            adCostAttributedByCampaignMap += part
          }
        }
      }
    }
  }

  // ── 포장비 ────────────────────────────────────────────────────────────
  const pricingSettings = await prisma.productPricingSettings.findUnique({
    where: { spaceId },
    select: { defaultPackagingCost: true },
  })
  const packagingUnit = Number(pricingSettings?.defaultPackagingCost ?? 0)
  if (packagingUnit === 0) {
    // 값이 0이면 "0원"이 아니라 사실상 미관리다. 숫자를 지어내지 않고 부재를 알린다.
    missingFields.push('packagingCost')
  }

  // ── 행 구성 ───────────────────────────────────────────────────────────
  const allRows = [...acc.entries()]
    .map(([optionId, a]) => {
      const opt = optionById.get(optionId)!
      const unitCost = costExVat(
        opt.costPrice == null ? null : Number(opt.costPrice),
        opt.costVatIncluded
      )
      const cogs = unitCost * a.quantity
      const packagingCost = packagingUnit * a.quantity
      const contributionProfit =
        a.revenue - cogs - a.shippingCost - packagingCost - a.commissionFee - a.adCost

      return {
        productId: opt.product.id,
        productName: opt.product.name,
        productInternalName: opt.product.internalName,
        optionId,
        optionName: opt.name,
        skuCode: opt.sku,
        quantity: Math.round(a.quantity * 100) / 100,
        revenue: a.revenue,
        cogs,
        shippingCost: a.shippingCost,
        packagingCost,
        commissionFee: a.commissionFee,
        adCost: a.adCost,
        contributionProfit,
        contributionMarginRatio: a.revenue > 0 ? contributionProfit / a.revenue : null,
        unitCost,
      }
    })
    .filter((r) => r.revenue !== 0 || r.adCost !== 0 || r.quantity !== 0)
    .sort((a, b) => b.revenue - a.revenue)

  const total = allRows.length
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize)

  const sum = (k: keyof (typeof allRows)[number]) =>
    allRows.reduce((s, r) => s + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)

  const revenueSum = sum('revenue')
  const contributionSum = sum('contributionProfit')

  // 귀속 실패분 + 이 조회의 옵션 필터 밖으로 빠진 매출.
  const unattributedRevenue = sales.unmatched.revenue + outOfScopeRevenue
  const unallocatedAdCost = Math.max(
    0,
    adCostTotal - adCostAttributedByBridge - adCostAttributedByCampaignMap
  )

  const summary = {
    from: params.from,
    to: params.to,
    revenue: revenueSum,
    cogs: sum('cogs'),
    shippingCost: sum('shippingCost'),
    packagingCost: sum('packagingCost'),
    commissionFee: sum('commissionFee'),
    adCost: sum('adCost'),
    contributionProfit: contributionSum,
    contributionMarginRatio: revenueSum > 0 ? contributionSum / revenueSum : null,
    unattributedRevenue,
    unallocatedAdCost,
    optionCount: total,
  }

  const coverage = {
    directShipping: {
      revenueTotal: directRevenueTotal,
      revenueAttributed: directRevenueAttributed,
      ratio: directRevenueTotal > 0 ? directRevenueAttributed / directRevenueTotal : null,
      lines: directLines,
      linesAttributed: directLinesAttributed,
    },
    rocketGrowth: {
      revenueTotal: rocketRevenueTotal,
      revenueAttributed: rocketRevenueAttributed,
      ratio: rocketRevenueTotal > 0 ? rocketRevenueAttributed / rocketRevenueTotal : null,
      bridgedExternalOptions: bridge.stats.bridgedExternalOptions,
    },
    adCost: {
      total: adCostTotal,
      byExternalOptionBridge: adCostAttributedByBridge,
      byCampaignProductMap: adCostAttributedByCampaignMap,
      unallocated: unallocatedAdCost,
      ratio:
        adCostTotal > 0
          ? (adCostAttributedByBridge + adCostAttributedByCampaignMap) / adCostTotal
          : null,
    },
    coupangLinked: coupang != null,
  }

  return {
    summary,
    rows,
    page,
    pageSize,
    total,
    nextCursor: page * pageSize < total ? String(page + 1) : null,
    coverage,
    missingFields,
  }
}
