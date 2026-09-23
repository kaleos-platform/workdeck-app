// 상품 단위 판매 집계 — 판매분석 "상품" 탭 랭킹의 단일 소스.
//
// 일자×내부옵션×채널의 수량과 **매출**을 두 경로로 집계한다:
//   - 직접배송: DelOrder.paymentAmount 를 라인 수량 비례로 배분(order-payment-alloc)
//              → fulfillments(있으면) 또는 optionId 직접 → 구성 옵션
//   - 로켓그로스: VENDOR_ITEM_METRICS (loadRocketDailyOptionQty)
//
// loadOptionDemand(발주 예측과 공유하는 수요 소스)를 건드리지 않고 평행하게 둔다 —
// 거기에 매출·미매칭을 얹으면 판매속도·예측정확도·세트계획이 조용히 바뀐다.
//
// ⚠️ 매출 정의는 채널 탭(/api/sh/dashboard/revenue)과 **글자 그대로 같아야 한다**.
//    기간 경계(KST), paymentAmount ?? 0, 채널 필터(isActive) 중 하나라도 어긋나면
//    커버리지 배지가 거짓말을 한다. 불변식: Σrows.revenue + unmatched.revenue == totalRevenue

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { loadRocketDailyOptionQty } from '@/lib/inv/coupang-sales-to-movement'
import { allocateOrderPayment } from '@/lib/sh/order-payment-alloc'
import type { DemandChannel } from '@/lib/inv/option-demand'

export type ProductSalesRow = {
  date: string // YYYY-MM-DD (KST)
  optionId: string
  optionName: string
  productId: string
  productName: string // 관리명 우선
  channelId: string
  quantity: number
  revenue: number
}

/** 상품에 귀속시키지 못한 매출. 사유별로 나눠 화면이 해결 경로를 안내할 수 있게 한다. */
export type UnmatchedBucket = {
  revenue: number
  quantity: number
  byReason: {
    directUnmatched: number // 옵션/리스팅 FK 없음 → 수동 매칭 드릴다운 대상
    directExcluded: number // 옵션은 붙었으나 삭제된 옵션 / INACTIVE 상품
    rocketUnmapped: number // 외부 코드가 InvLocationProductMap 에 없음
    rocketExcluded: number
  }
}

export type ProductSalesCoverage = {
  totalRevenue: number
  attributedRevenue: number
  ratio: number | null // totalRevenue 0 이면 null
  direct: {
    revenueTotal: number
    revenueAttributed: number
    lines: number
    linesAttributed: number
  }
  rocket: { revenueTotal: number; revenueAttributed: number; unmappedRevenue: number }
}

export type ProductSalesResult = {
  rows: ProductSalesRow[]
  unmatched: UnmatchedBucket
  coverage: ProductSalesCoverage
}

/** Date → KST 일자 키 (revenue route 와 동일 규칙). */
function toKstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

type OptionMeta = {
  optionId: string
  optionName: string
  productId: string
  productName: string
}

type SelectedOption = {
  id: string
  name: string
  deletedAt: Date | null
  productId: string
  product: { name: string; internalName: string | null; status: string }
}

/** 상품명은 관리명(internalName) 우선. */
function metaOf(o: SelectedOption): OptionMeta {
  const internal = o.product.internalName?.trim()
  return {
    optionId: o.id,
    optionName: o.name,
    productId: o.productId,
    productName: internal && internal.length > 0 ? internal : o.product.name,
  }
}

/** 삭제된 옵션 / 비활성 상품은 랭킹에서 제외하되 매출은 미매칭 버킷에 남긴다. */
function isExcluded(o: SelectedOption): boolean {
  return o.deletedAt !== null || o.product.status !== 'ACTIVE'
}

const OPTION_SELECT = {
  id: true,
  name: true,
  deletedAt: true,
  productId: true,
  product: { select: { name: true, internalName: true, status: true } },
} as const

/**
 * 한 Space 의 기간 [from, to] 상품×채널×일자 수량·매출을 집계한다.
 *
 * @param channels 활성·필터 적용 후의 대상 채널. 로켓그로스 채널이 포함되면 VENDOR 를 합산한다.
 */
export async function loadProductSales(
  spaceId: string,
  from: Date,
  to: Date,
  channels: DemandChannel[]
): Promise<ProductSalesResult> {
  const unmatched: UnmatchedBucket = {
    revenue: 0,
    quantity: 0,
    byReason: {
      directUnmatched: 0,
      directExcluded: 0,
      rocketUnmapped: 0,
      rocketExcluded: 0,
    },
  }
  const coverage: ProductSalesCoverage = {
    totalRevenue: 0,
    attributedRevenue: 0,
    ratio: null,
    direct: { revenueTotal: 0, revenueAttributed: 0, lines: 0, linesAttributed: 0 },
    rocket: { revenueTotal: 0, revenueAttributed: 0, unmappedRevenue: 0 },
  }

  if (channels.length === 0) return { rows: [], unmatched, coverage }

  const keyMap = new Map<string, ProductSalesRow>()
  const add = (date: string, meta: OptionMeta, channelId: string, qty: number, revenue: number) => {
    if (qty === 0 && revenue === 0) return
    const key = `${date}|${meta.optionId}|${channelId}`
    const entry =
      keyMap.get(key) ??
      ({ date, ...meta, channelId, quantity: 0, revenue: 0 } satisfies ProductSalesRow)
    entry.quantity += qty
    entry.revenue += revenue
    keyMap.set(key, entry)
  }

  // ───── 직접배송: DelOrder → 라인 배분 → 구성 옵션 ────────────────────────────
  const orders = await prisma.delOrder.findMany({
    where: {
      spaceId,
      channelId: { in: channels.map((c) => c.id) },
      orderDate: { gte: from, lte: to },
    },
    select: {
      channelId: true,
      orderDate: true,
      paymentAmount: true,
      items: {
        select: {
          quantity: true,
          option: { select: OPTION_SELECT },
          fulfillments: {
            select: { quantity: true, option: { select: OPTION_SELECT } },
          },
        },
      },
    },
  })

  for (const order of orders) {
    const channelId = order.channelId
    if (!channelId) continue
    const payment = order.paymentAmount ? Number(order.paymentAmount) : 0
    coverage.totalRevenue += payment
    coverage.direct.revenueTotal += payment

    const date = toKstDateKey(order.orderDate)
    const lineAmounts = allocateOrderPayment(
      payment,
      order.items.map((i) => i.quantity)
    )

    // 수량 합이 0이거나 결제금액이 없으면 배분되지 않은 잔액이 남는다 → 미매칭.
    const allocated = lineAmounts.reduce((a, b) => a + b, 0)
    if (payment > allocated) {
      const residual = payment - allocated
      unmatched.revenue += residual
      unmatched.byReason.directUnmatched += residual
    }

    order.items.forEach((item, idx) => {
      const amount = lineAmounts[idx] ?? 0
      coverage.direct.lines += 1

      if (item.fulfillments.length > 0) {
        // 묶음/listing → 구성 옵션 팬아웃. fulfillment.quantity 는 이미 분해된 수량이므로
        // 금액도 그 수량 비중으로 나눈다 (합 보존).
        const parts = allocateOrderPayment(
          amount,
          item.fulfillments.map((f) => f.quantity)
        )
        let attributed = 0
        item.fulfillments.forEach((f, fi) => {
          const part = parts[fi] ?? 0
          if (!f.option) {
            unmatched.revenue += part
            unmatched.quantity += f.quantity
            unmatched.byReason.directUnmatched += part
            return
          }
          if (isExcluded(f.option)) {
            unmatched.revenue += part
            unmatched.quantity += f.quantity
            unmatched.byReason.directExcluded += part
            return
          }
          add(date, metaOf(f.option), channelId, f.quantity, part)
          attributed += part
        })
        if (attributed > 0) {
          coverage.direct.revenueAttributed += attributed
          coverage.direct.linesAttributed += 1
        }
        return
      }

      if (item.option && !isExcluded(item.option)) {
        add(date, metaOf(item.option), channelId, item.quantity, amount)
        coverage.direct.revenueAttributed += amount
        coverage.direct.linesAttributed += 1
        return
      }

      unmatched.revenue += amount
      unmatched.quantity += item.quantity
      if (item.option) unmatched.byReason.directExcluded += amount
      else unmatched.byReason.directUnmatched += amount
    })
  }

  // ───── 로켓그로스: VENDOR → 내부 옵션 ───────────────────────────────────────
  const rocketCh = channels.find((c) => c.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH)
  if (rocketCh) {
    const { rows: rocketRows, unmapped } = await loadRocketDailyOptionQty(spaceId, from, to)

    // 삭제된 옵션 / INACTIVE 상품 판별 (로더는 상태를 보지 않는다).
    const optionIds = Array.from(new Set(rocketRows.map((r) => r.optionId)))
    const options = optionIds.length
      ? await prisma.invProductOption.findMany({
          where: { id: { in: optionIds } },
          select: OPTION_SELECT,
        })
      : []
    const excludedIds = new Set(options.filter(isExcluded).map((o) => o.id))

    for (const r of rocketRows) {
      coverage.totalRevenue += r.revenue
      coverage.rocket.revenueTotal += r.revenue
      if (excludedIds.has(r.optionId)) {
        unmatched.revenue += r.revenue
        unmatched.quantity += r.quantity
        unmatched.byReason.rocketExcluded += r.revenue
        continue
      }
      add(
        r.date,
        {
          optionId: r.optionId,
          optionName: r.optionName,
          productId: r.productId,
          productName: r.productName,
        },
        rocketCh.id,
        r.quantity,
        r.revenue
      )
      coverage.rocket.revenueAttributed += r.revenue
    }

    coverage.totalRevenue += unmapped.revenue
    coverage.rocket.revenueTotal += unmapped.revenue
    coverage.rocket.unmappedRevenue = unmapped.revenue
    unmatched.revenue += unmapped.revenue
    unmatched.quantity += unmapped.quantity
    unmatched.byReason.rocketUnmapped += unmapped.revenue
  }

  const rows = Array.from(keyMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || b.revenue - a.revenue
  )
  coverage.attributedRevenue = rows.reduce((a, r) => a + r.revenue, 0)
  coverage.ratio =
    coverage.totalRevenue > 0 ? coverage.attributedRevenue / coverage.totalRevenue : null

  return { rows, unmatched, coverage }
}
