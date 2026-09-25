// 상품 단위 생산차수 가중평균 원가 — 상품 상세 화면과 공헌이익(margin-query)의 단일 소스.
//
// useProductionCost=true 인 상품은 수동 costPrice 대신 이 값을 원가로 쓴다.
// 예전엔 margin-query 만 수동 costPrice 를 읽어 화면과 원가가 달랐다
// (모달 머드팬티 수동 ₩10,590 vs 생산차수 ₩5,531 — 1.91배 과대).

import { prisma } from '@/lib/prisma'
import { costExVat } from '@/lib/sh/cost'

/**
 * 입고완료(STOCKED_IN) 생산차수의 ex-VAT 가중평균 단가 = Σ원가 ÷ Σ발주수량.
 * 원가는 run 단위라 옵션별로 나눌 수 없어 상품 단위 단가다.
 *
 * @returns productId → 단가. 입고완료 차수가 없거나 수량 0인 상품은 빠진다.
 */
export async function loadProductionUnitCosts(
  spaceId: string,
  productIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (productIds.length === 0) return out

  const runs = await prisma.productionRun.findMany({
    where: {
      spaceId,
      status: 'STOCKED_IN',
      // 0 = BREAKDOWN 모드 비용 미입력 저장값일 수 있어 제외 (가중평균 왜곡 방지)
      totalCost: { gt: 0 },
      items: { some: { option: { productId: { in: productIds } } } },
    },
    select: {
      totalCost: true,
      items: { select: { quantity: true, option: { select: { productId: true } } } },
      costs: { select: { amount: true, vatIncluded: true } },
    },
  })

  const acc = new Map<string, { cost: number; qty: number }>()
  for (const r of runs) {
    // costs 항목이 있으면 항목별 vatIncluded 로 ÷1.1, 없으면(구 데이터) totalCost as-is.
    const exVat =
      r.costs.length > 0
        ? r.costs.reduce((s, c) => s + costExVat(Number(c.amount), c.vatIncluded), 0)
        : Number(r.totalCost ?? 0)
    const qty = r.items.reduce((s, it) => s + it.quantity, 0)
    // 상세 화면 규약과 동일: 상품을 포함한 run 의 **전체** 원가·수량을 그 상품에 더한다.
    const pids = new Set(r.items.map((it) => it.option.productId))
    for (const pid of pids) {
      if (!productIds.includes(pid)) continue
      const cur = acc.get(pid) ?? { cost: 0, qty: 0 }
      cur.cost += exVat
      cur.qty += qty
      acc.set(pid, cur)
    }
  }
  for (const [pid, v] of acc) if (v.qty > 0) out.set(pid, v.cost / v.qty)
  return out
}
