import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { loadRocketDailyOptionQty } from '@/lib/inv/coupang-sales-to-movement'

// 판매분석 "상품(옵션)" 탭 — 일자×내부옵션×채널 판매량(수량) 집계.
// revenue API(groupBy=date)의 이중 경로(수동 DelOrder + 로켓 VENDOR)를 옵션 grain 으로 미러링.
//   - 수동채널: DelOrderItem → fulfillments(있으면) 또는 optionId 직접 → 구성 옵션 단위 quantity.
//   - 로켓그로스: loadRocketDailyOptionQty (VENDOR salesQty → 재고차감과 동일 매핑 → 내부 옵션).
// 옵션 식별은 양쪽 모두 내부 InvProductOption.id → 채널 간 동일 옵션 병합 가능.

type OptionQtyRow = {
  date: string // YYYY-MM-DD (KST)
  optionId: string
  optionName: string // 옵션명 (InvProductOption.name)
  productId: string // 내부 InvProduct.id
  productName: string // 상품명 (관리명 우선)
  channelId: string
  quantity: number
}

/** Date 를 KST 일자 YYYY-MM-DD 로. (revenue route 와 동일) */
function toKstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const channelIdsParam = searchParams.get('channelIds')

  if (!fromParam || !toParam) {
    return errorResponse('from, to 쿼리 파라미터가 필요합니다', 400)
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)
  to.setHours(23, 59, 59, 999)

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return errorResponse('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)', 400)
  }
  if (from > to) {
    return errorResponse('from이 to보다 이후일 수 없습니다', 400)
  }

  const channelIds = channelIdsParam
    ? channelIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  const channels = await prisma.channel.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(channelIds && channelIds.length > 0 ? { id: { in: channelIds } } : {}),
      isActive: true,
    },
    select: { id: true, name: true, externalSource: true },
    orderBy: { name: 'asc' },
  })

  if (channels.length === 0) {
    return NextResponse.json({ period: { from: fromParam, to: toParam }, rows: [] })
  }

  const targetChannelIds = channels.map((c) => c.id)

  // (date|optionId|channelId) → row
  const keyMap = new Map<string, OptionQtyRow>()
  const addQty = (
    date: string,
    opt: { optionId: string; optionName: string; productId: string; productName: string },
    channelId: string,
    quantity: number
  ) => {
    if (quantity <= 0) return
    const key = `${date}|${opt.optionId}|${channelId}`
    const entry =
      keyMap.get(key) ??
      ({
        date,
        optionId: opt.optionId,
        optionName: opt.optionName,
        productId: opt.productId,
        productName: opt.productName,
        channelId,
        quantity: 0,
      } satisfies OptionQtyRow)
    entry.quantity += quantity
    keyMap.set(key, entry)
  }

  // ───── 수동채널: DelOrderItem → 구성 옵션 단위 ──────────────────────────────
  const items = await prisma.delOrderItem.findMany({
    where: {
      order: {
        spaceId: resolved.space.id,
        channelId: { in: targetChannelIds },
        orderDate: { gte: from, lte: to },
      },
    },
    select: {
      quantity: true,
      optionId: true,
      option: {
        select: {
          id: true,
          name: true,
          productId: true,
          product: { select: { name: true, internalName: true } },
        },
      },
      fulfillments: {
        select: {
          quantity: true,
          option: {
            select: {
              id: true,
              name: true,
              productId: true,
              product: { select: { name: true, internalName: true } },
            },
          },
        },
      },
      order: { select: { orderDate: true, channelId: true } },
    },
  })

  // 옵션 → 집계용 메타 (옵션명 + 상품 분리). 상품명은 관리명 우선.
  const optMeta = (o: {
    id: string
    name: string
    productId: string
    product: { name: string; internalName: string | null }
  }) => {
    const internal = o.product.internalName?.trim()
    const productName = internal && internal.length > 0 ? internal : o.product.name
    return { optionId: o.id, optionName: o.name, productId: o.productId, productName }
  }

  for (const it of items) {
    const channelId = it.order.channelId
    if (!channelId) continue
    const date = toKstDateKey(it.order.orderDate)

    if (it.fulfillments.length > 0) {
      // 묶음/listing → 구성 옵션으로 팬아웃 (DelOrderItemFulfillment.quantity 는 이미 분해된 수량)
      for (const f of it.fulfillments) {
        if (!f.option) continue
        addQty(date, optMeta(f.option), channelId, f.quantity)
      }
    } else if (it.option) {
      // 단일 옵션 직접 매칭
      addQty(date, optMeta(it.option), channelId, it.quantity)
    }
    // option·fulfillment 둘 다 없으면(미매칭) 옵션 귀속 불가 → 제외 (무음 누락이나 v1 범위 밖)
  }

  // ───── 로켓그로스: VENDOR → 내부 옵션 (재고차감 동일 매핑) ─────────────────────
  const rocketCh = channels.find((c) => c.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH)
  if (rocketCh) {
    const rocketRows = await loadRocketDailyOptionQty(resolved.space.id, from, to)
    for (const r of rocketRows) {
      addQty(
        r.date,
        {
          optionId: r.optionId,
          optionName: r.optionName,
          productId: r.productId,
          productName: r.productName,
        },
        rocketCh.id,
        r.quantity
      )
    }
  }

  const rows = Array.from(keyMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || b.quantity - a.quantity
  )

  return NextResponse.json({ period: { from: fromParam, to: toParam }, rows })
}
