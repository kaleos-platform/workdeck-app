import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { last30DaysRange } from '@/lib/sh/sales-analytics'
import { productDisplayName } from '@/lib/sh/product-display'
import { loadRocketDailyOptionQty } from '@/lib/inv/coupang-sales-to-movement'

// 홈 대시보드 "상품 현황" 카드 — 최근 30일 주문건수 기준 상위/부진 상품.
//
// 주문건수(orderCount) = 상품별 COUNT(DISTINCT orderId). 한 주문에 같은 상품 라인이
// 여러 개여도 1건. (판매량 quantity 와 다른 grain — loadOptionDemand 재사용 불가.)
//
// 상위: 주문건수 desc. 수동채널 DelOrderItem 만 집계 (로켓그로스는 옵션/상품별 주문건수
//       데이터가 없어 주문 기준 랭킹 불가 — 카드에 "직접배송 채널 기준" 명시).
// 부진: ACTIVE 상품 카탈로그에서 출발해 30일 주문건수 left-join → 0판매 포함 asc 정렬.
//       윈도우 내 신규 등록 상품(createdAt >= 윈도우 시작)은 false positive 방지로 제외.
//       로켓그로스에서 판매된 상품은 부진에서 제외 — 주문건수 0 이어도 로켓 판매가
//       있으면 진짜 부진이 아니다 (로켓은 핵심 채널이라 오탐 영향이 큼).

type ProductAcc = {
  productId: string
  productName: string
  orderIds: Set<string>
  salesQty: number
}

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const window = last30DaysRange()
  const from = new Date(`${window.from}T00:00:00+09:00`)
  const to = new Date(`${window.to}T23:59:59.999+09:00`)

  // ── 수동채널 주문 라인 → 상품별 주문건수·판매량 집계 ─────────────────────
  const items = await prisma.delOrderItem.findMany({
    where: { order: { spaceId, orderDate: { gte: from, lte: to } } },
    select: {
      quantity: true,
      optionId: true,
      option: {
        select: { product: { select: { id: true, name: true, internalName: true } } },
      },
      fulfillments: {
        select: {
          quantity: true,
          option: { select: { product: { select: { id: true, name: true, internalName: true } } } },
        },
      },
      order: { select: { id: true } },
    },
  })

  const acc = new Map<string, ProductAcc>()
  const add = (
    p: { id: string; name: string; internalName: string | null },
    orderId: string,
    qty: number
  ) => {
    let entry = acc.get(p.id)
    if (!entry) {
      entry = {
        productId: p.id,
        productName: productDisplayName(p),
        orderIds: new Set(),
        salesQty: 0,
      }
      acc.set(p.id, entry)
    }
    entry.orderIds.add(orderId)
    entry.salesQty += qty
  }

  for (const it of items) {
    if (it.fulfillments.length > 0) {
      for (const f of it.fulfillments) {
        if (f.option?.product) add(f.option.product, it.order.id, f.quantity)
      }
    } else if (it.option?.product) {
      add(it.option.product, it.order.id, it.quantity)
    }
  }

  const ranked = Array.from(acc.values()).map((e) => ({
    productId: e.productId,
    productName: e.productName,
    orderCount: e.orderIds.size,
    salesQty: e.salesQty,
  }))

  // ── 상위: 주문건수 desc ───────────────────────────────────────────────────
  const top = [...ranked]
    .sort((a, b) => b.orderCount - a.orderCount || b.salesQty - a.salesQty)
    .slice(0, 5)

  // ── 로켓그로스 판매 상품 집합 (부진 오탐 제외용) ──────────────────────────
  // 로켓은 옵션/상품별 주문건수가 없어 상위 랭킹엔 못 쓰지만, 판매량(quantity)으로
  // "이 상품은 로켓에서 팔리고 있다"는 사실은 알 수 있다 → 부진 후보에서 제외.
  const rocketRows = await loadRocketDailyOptionQty(spaceId, from, to)
  const rocketSoldProductIds = new Set<string>()
  for (const r of rocketRows) {
    if (r.quantity > 0) rocketSoldProductIds.add(r.productId)
  }

  // ── 부진: ACTIVE 상품 카탈로그 left-join (0판매 포함) ─────────────────────
  // 윈도우 시작 전부터 존재한 ACTIVE 상품만 (신규 상품 오탐 방지).
  // 로켓 판매가 있는 상품은 제외 (직접배송 주문이 0이어도 진짜 부진 아님).
  const activeProducts = await prisma.invProduct.findMany({
    where: { spaceId, status: 'ACTIVE', createdAt: { lt: from } },
    select: { id: true, name: true, internalName: true },
  })

  const orderCountByProduct = new Map(ranked.map((r) => [r.productId, r]))
  const bottom = activeProducts
    .filter((p) => !rocketSoldProductIds.has(p.id))
    .map((p) => {
      const hit = orderCountByProduct.get(p.id)
      return {
        productId: p.id,
        productName: productDisplayName(p),
        orderCount: hit?.orderCount ?? 0,
        salesQty: hit?.salesQty ?? 0,
      }
    })
    .sort((a, b) => a.orderCount - b.orderCount || a.salesQty - b.salesQty)
    .slice(0, 5)

  return NextResponse.json({ window, top, bottom })
}
