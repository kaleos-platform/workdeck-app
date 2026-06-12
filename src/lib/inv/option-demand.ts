// 옵션 단위 주문수요 집계 — 판매분석 "상품(옵션)" 탭과 발주 예측의 단일 소스.
//
// 일자×내부옵션×채널 판매량(수량)을 두 경로로 미러링한다(매출 revenue route 와 평행):
//   - 수동채널: DelOrderItem → fulfillments(있으면) 또는 optionId 직접 → 구성 옵션 단위 quantity.
//   - 로켓그로스: loadRocketDailyOptionQty (VENDOR salesQty → 재고차감과 동일 매핑 → 내부 옵션).
// 옵션 식별은 양쪽 모두 내부 InvProductOption.id → 채널 간 동일 옵션 병합 가능.
//
// 발주 예측(reorder)과 판매분석이 이 함수를 공유한다 → 두 화면이 정의상 같은 수요를 본다.
// (발주 예측은 OUTBOUND 장부 대신 이 주문수요를 읽는다. OUTBOUND 는 재고차감·정확도 baseline 전용.)

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { loadRocketDailyOptionQty } from '@/lib/inv/coupang-sales-to-movement'

export type OptionQtyRow = {
  date: string // YYYY-MM-DD (KST)
  optionId: string // 내부 InvProductOption.id
  optionName: string // 옵션명 (InvProductOption.name)
  productId: string // 내부 InvProduct.id
  productName: string // 상품명 (관리명 우선)
  channelId: string
  quantity: number
}

/** 집계 대상 채널 (호출부에서 활성·필터 적용 후 전달). */
export type DemandChannel = {
  id: string
  name: string
  externalSource: string | null
}

/** Date 를 KST 일자 YYYY-MM-DD 로. (revenue route 와 동일) */
function toKstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 한 Space 의 기간 [from, to] 옵션×일자×채널 주문수요(수량)를 집계한다.
 *
 * @param channels 집계 대상 채널. 빈 배열이면 빈 결과. 로켓그로스 채널이 포함되면
 *                 loadRocketDailyOptionQty 로 VENDOR 판매를 합산한다.
 * @returns (date|optionId|channelId) 단위로 합산된 행 배열. 옵션 귀속 불가(미매칭)는 제외.
 */
export async function loadOptionDemand(
  spaceId: string,
  from: Date,
  to: Date,
  channels: DemandChannel[]
): Promise<OptionQtyRow[]> {
  if (channels.length === 0) return []

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
        spaceId,
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
    const rocketRows = await loadRocketDailyOptionQty(spaceId, from, to)
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

  return Array.from(keyMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || b.quantity - a.quantity
  )
}
