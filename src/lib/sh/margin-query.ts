/**
 * SKU/옵션 단위 공헌이익 집계.
 *
 *   contributionProfit      = revenue - cogs - shippingCost - packagingCost - commissionFee - adCost
 *   contributionMarginRatio = contributionProfit / revenue      (revenue = 0 이면 null)
 *
 * 설계 원칙 — 귀속에 실패한 금액을 옵션에 흩뿌리지 않는다.
 * 직접배송 주문의 61%(2026-07 실측)가 옵션/리스팅 미매칭이고, 로켓 매출·광고비도
 * 외부 브리지로 약 35%만 이어진다. 실패분을 추정 배분하면 공헌이익률이 조용히
 * 왜곡되므로 unattributedRevenue / unallocatedAdCost 로 분리하고 coverage 를 함께 낸다.
 *
 * 매출원 2종:
 *   - 직접배송: DelOrderItem (optionId 직접 → 없으면 listingId 팬아웃).
 *     DelOrder.paymentAmount 가 주문 단위라 라인 정가 비례로 배분한다.
 *   - 로켓그로스: InventoryRecord(VENDOR_ITEM_METRICS/로켓그로스) → 외부 옵션 브리지.
 */

import { prisma } from '@/lib/prisma'
import { costExVat } from '@/lib/sh/cost'
import { lookupCategoryFeePct, DEFAULT_FEE_CATEGORY } from '@/lib/sh/channel-fee-lookup'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { loadExternalOptionBridge, allocateByBridge } from '@/lib/sh/external-option-bridge'

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
  const shippingOf = (chId: string | null, revenue: number, qty: number): number => {
    const c = chId ? channelById.get(chId) : undefined
    if (!c) return 0
    if (c.shippingFeeType === 'PERCENT') return revenue * Number(c.shippingFeePct ?? 0)
    return Number(c.shippingFee ?? 0) * qty
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

  // ── 1) 직접배송 매출 ──────────────────────────────────────────────────
  const orders = await prisma.delOrder.findMany({
    where: { spaceId, orderDate: { gte, lt } },
    select: {
      id: true,
      channelId: true,
      paymentAmount: true,
      items: {
        select: {
          quantity: true,
          optionId: true,
          listingId: true,
          listing: {
            select: {
              retailPrice: true,
              channelId: true,
              items: { select: { optionId: true, quantity: true } },
            },
          },
          option: { select: { id: true, retailPrice: true } },
        },
      },
    },
  })

  let directRevenueTotal = 0
  let directRevenueAttributed = 0
  let directLines = 0
  let directLinesAttributed = 0

  for (const o of orders) {
    // 라인별 정가 가중치 — paymentAmount(주문 단위)를 라인으로 나누는 분모.
    const lineWeights = o.items.map((it) => {
      const unit =
        it.listing?.retailPrice != null
          ? Number(it.listing.retailPrice)
          : it.option?.retailPrice != null
            ? Number(it.option.retailPrice)
            : 0
      return unit * it.quantity
    })
    const weightSum = lineWeights.reduce((s, w) => s + w, 0)
    const payment = o.paymentAmount == null ? null : Number(o.paymentAmount)
    if (payment == null && weightSum === 0) {
      // 금액 근거가 아예 없는 주문 — 매출로 세지 않는다.
      directLines += o.items.length
      continue
    }
    const orderRevenue = payment ?? weightSum
    directRevenueTotal += orderRevenue

    o.items.forEach((it, idx) => {
      directLines += 1
      const lineRevenue =
        weightSum > 0
          ? orderRevenue * (lineWeights[idx] / weightSum)
          : orderRevenue / Math.max(1, o.items.length)

      const chId = it.listing?.channelId ?? o.channelId ?? null
      if (!matchesChannel(chId)) return

      // 우선순위: optionId 직접 → listing 구성 팬아웃
      let targets: { optionId: string; share: number; qty: number }[] = []
      if (it.optionId) {
        targets = [{ optionId: it.optionId, share: 1, qty: it.quantity }]
      } else if (it.listing && it.listing.items.length > 0) {
        const unitsTotal = it.listing.items.reduce((s, li) => s + Math.max(0, li.quantity), 0)
        if (unitsTotal > 0) {
          targets = it.listing.items.map((li) => ({
            optionId: li.optionId,
            share: li.quantity / unitsTotal,
            qty: li.quantity * it.quantity,
          }))
        }
      }
      if (targets.length === 0) return // 미매칭 — unattributed 로 남는다

      directLinesAttributed += 1
      for (const t of targets) {
        if (!optionIdSet.has(t.optionId)) continue
        const rev = lineRevenue * t.share
        directRevenueAttributed += rev
        bump(t.optionId, {
          revenue: rev,
          quantity: t.qty,
          commissionFee: rev * feePctOf(chId),
          shippingCost: shippingOf(chId, rev, t.qty),
        })
      }
    })
  }

  // ── 2) 로켓그로스 매출 + 3) 광고비 ────────────────────────────────────
  const coupang = await resolveCoupangWorkspaceForSpace(spaceId)
  const bridge = coupang
    ? await loadExternalOptionBridge(spaceId, coupang.workspaceId)
    : { byExternalOptionId: new Map(), stats: { dictEntries: 0, bridgedExternalOptions: 0 } }

  const rocketChannel = channels.find((c) => c.name.includes('로켓그로스')) ?? null
  let rocketRevenueTotal = 0
  let rocketRevenueAttributed = 0
  let adCostTotal = 0
  let adCostAttributedByBridge = 0
  let adCostAttributedByCampaignMap = 0

  if (coupang) {
    // 2) 로켓 VENDOR 매출
    if (matchesChannel(rocketChannel?.id ?? null)) {
      const vendorRows = await prisma.inventoryRecord.findMany({
        where: {
          workspaceId: coupang.workspaceId,
          fileType: 'VENDOR_ITEM_METRICS',
          fulfillmentType: '로켓그로스',
          snapshotDate: { gte, lt },
        },
        select: { optionId: true, revenue30d: true, salesQty30d: true },
      })
      const entries = vendorRows.map((r) => ({
        externalOptionId: r.optionId,
        amount: Number(r.revenue30d ?? 0),
        quantity: r.salesQty30d ?? 0,
      }))
      rocketRevenueTotal = entries.reduce((s, e) => s + e.amount, 0)

      const { byOption } = allocateByBridge(bridge, entries)
      const chId = rocketChannel?.id ?? null
      for (const [optionId, v] of byOption) {
        if (!optionIdSet.has(optionId)) continue
        rocketRevenueAttributed += v.amount
        bump(optionId, {
          revenue: v.amount,
          quantity: v.quantity,
          commissionFee: v.amount * feePctOf(chId),
          shippingCost: shippingOf(chId, v.amount, v.quantity),
        })
      }
    }

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

  const unattributedRevenue =
    directRevenueTotal - directRevenueAttributed + (rocketRevenueTotal - rocketRevenueAttributed)
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
