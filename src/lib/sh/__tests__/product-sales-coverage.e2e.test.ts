// 커버리지 불변식 — 상품 랭킹 합계가 채널 탭 총매출과 어긋나면 배지가 거짓말을 한다.
// 읽기 전용. DATABASE_URL 이 가리키는 DB 의 실제 데이터로 검증한다.

import { prisma } from '@/lib/prisma'
import { loadProductSales } from '@/lib/sh/product-sales'
import { loadRocketDailyRevenue, sumRocketDaily } from '@/lib/sh/rocket-revenue'

const DAYS = 90

describe('loadProductSales 커버리지 불변식', () => {
  it('Σrows.revenue + unmatched.revenue == coverage.totalRevenue == 채널탭 총매출', async () => {
    const space = await prisma.space.findFirst({
      where: { channels: { some: {} } },
      select: { id: true },
    })
    if (!space) {
      console.warn('채널이 있는 space 가 없어 검증을 건너뜁니다')
      return
    }

    const to = new Date()
    const from = new Date(to.getTime() - DAYS * 24 * 60 * 60 * 1000)

    const channels = await prisma.channel.findMany({
      where: { spaceId: space.id, isActive: true },
      select: { id: true, name: true, externalSource: true },
    })

    const result = await loadProductSales(space.id, from, to, channels)

    // ① 내부 불변식: 귀속 + 미매칭 = 전체
    const rowsSum = result.rows.reduce((a, r) => a + r.revenue, 0)
    expect(
      Math.abs(rowsSum + result.unmatched.revenue - result.coverage.totalRevenue)
    ).toBeLessThanOrEqual(1)

    // ② 채널 탭 정의와 동일한지: DelOrder.paymentAmount 합 + 로켓 VENDOR 매출 합
    const orders = await prisma.delOrder.findMany({
      where: {
        spaceId: space.id,
        channelId: { in: channels.map((c) => c.id) },
        orderDate: { gte: from, lte: to },
      },
      select: { paymentAmount: true },
    })
    const directTotal = orders.reduce(
      (a, o) => a + (o.paymentAmount ? Number(o.paymentAmount) : 0),
      0
    )

    const hasRocket = channels.some((c) => c.externalSource === 'coupang_rocket_growth')
    const rocketTotal = hasRocket
      ? sumRocketDaily(await loadRocketDailyRevenue(space.id, from, to)).revenue
      : 0

    expect(Math.abs(result.coverage.direct.revenueTotal - directTotal)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.coverage.rocket.revenueTotal - rocketTotal)).toBeLessThanOrEqual(1)

    console.log(
      JSON.stringify(
        {
          totalRevenue: Math.round(result.coverage.totalRevenue),
          attributed: Math.round(result.coverage.attributedRevenue),
          ratio: result.coverage.ratio,
          direct: result.coverage.direct,
          rocket: result.coverage.rocket,
          unmatched: result.unmatched.byReason,
          rows: result.rows.length,
        },
        null,
        2
      )
    )
  })
})
