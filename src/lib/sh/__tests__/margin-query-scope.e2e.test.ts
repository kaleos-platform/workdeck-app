// 조회 스코프(productIds)를 좁혀도 옵션별 비용이 달라지면 안 된다.
// 배송비 분모를 스코프 안쪽만으로 만들면 채널 전체 배송비가 한 상품에 얹힌다.

import { prisma } from '@/lib/prisma'
import { queryProductMargin } from '@/lib/sh/margin-query'
import { lastClosedDateKst, addDaysYmd } from '@/lib/sh/sales-analytics'

describe('queryProductMargin 스코프 불변', () => {
  it('productIds 로 좁혀도 그 상품의 비용이 동일하다', async () => {
    const space = await prisma.space.findFirst({
      where: { channels: { some: {} } },
      select: { id: true },
    })
    if (!space) return
    const anchor = lastClosedDateKst()
    const params = { from: addDaysYmd(anchor, -89), to: anchor, page: 1, pageSize: 500 }

    const all = await queryProductMargin(space.id, params)
    if (all.rows.length === 0) return
    const target = all.rows[0].productId

    const scoped = await queryProductMargin(space.id, { ...params, productIds: [target] })
    const byOption = new Map(scoped.rows.map((r) => [r.optionId, r]))

    for (const r of all.rows.filter((x) => x.productId === target)) {
      const s = byOption.get(r.optionId)
      expect(s).toBeDefined()
      for (const k of [
        'revenue',
        'quantity',
        'cogs',
        'shippingCost',
        'commissionFee',
        'adCost',
      ] as const) {
        expect(Math.abs((s![k] as number) - (r[k] as number))).toBeLessThanOrEqual(1)
      }
    }
  }, 300000)
})
