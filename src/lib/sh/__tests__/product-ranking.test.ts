import { buildProductRanking, type OptionQtyRow } from '@/lib/sh/sales-analytics'

const row = (o: Partial<OptionQtyRow>): OptionQtyRow => ({
  date: '2026-09-01',
  optionId: 'o1',
  optionName: '옵션1',
  productId: 'p1',
  productName: '상품1',
  productGroupId: 'g1',
  productGroupName: '그룹1',
  channelId: 'c1',
  quantity: 1,
  revenue: 1000,
  ...o,
})

const NONE = { revenue: 0, quantity: 0 }

describe('buildProductRanking', () => {
  it('상품 단위로 합산하고 채널·옵션 내역을 남긴다', () => {
    const r = buildProductRanking(
      [
        row({ channelId: 'c1', quantity: 2, revenue: 2000 }),
        row({ channelId: 'c2', quantity: 1, revenue: 1500 }),
        row({ optionId: 'o2', optionName: '옵션2', quantity: 3, revenue: 900 }),
      ],
      [],
      NONE
    )
    expect(r.rows).toHaveLength(1)
    const p = r.rows[0]
    expect(p.quantity).toBe(6)
    expect(p.revenue).toBe(4400)
    expect(p.byChannel.map((c) => c.channelId).sort()).toEqual(['c1', 'c2'])
    expect(p.options).toHaveLength(2)
    // 옵션·채널 내역 합이 행 합계와 일치
    expect(p.options.reduce((a, o) => a + o.revenue, 0)).toBe(p.revenue)
    expect(p.byChannel.reduce((a, c) => a + c.revenue, 0)).toBe(p.revenue)
  })

  it('매출 desc 로 정렬된다', () => {
    const r = buildProductRanking(
      [
        row({ productId: 'p1', productName: 'A', revenue: 100 }),
        row({ productId: 'p2', productName: 'B', optionId: 'o2', revenue: 500 }),
      ],
      [],
      NONE
    )
    expect(r.rows.map((x) => x.productName)).toEqual(['B', 'A'])
  })

  it('비중 합 + 미매칭 비중 = 1', () => {
    const r = buildProductRanking(
      [row({ revenue: 7000 }), row({ productId: 'p2', optionId: 'o2', revenue: 1000 })],
      [],
      { revenue: 2000, quantity: 1 }
    )
    const sum = r.rows.reduce((a, x) => a + (x.share ?? 0), 0) + (r.unmatched.share ?? 0)
    expect(sum).toBeCloseTo(1, 10)
    expect(r.totals.revenue).toBe(10000)
  })

  it('이전 구간에만 있던 상품도 행으로 살아난다 (급감 탐지)', () => {
    const r = buildProductRanking(
      [row({ productId: 'p1', revenue: 1000 })],
      [{ optionId: 'oX', productId: 'pGone', quantity: 5, revenue: 5000 }],
      NONE
    )
    const gone = r.rows.find((x) => x.productId === 'pGone')
    expect(gone).toBeDefined()
    expect(gone!.revenue).toBe(0)
    expect(gone!.prevRevenue).toBe(5000)
  })

  it('이전 구간 값이 상품 합계로 올라간다', () => {
    const r = buildProductRanking(
      [row({ optionId: 'o1' }), row({ optionId: 'o2' })],
      [
        { optionId: 'o1', productId: 'p1', quantity: 1, revenue: 300 },
        { optionId: 'o2', productId: 'p1', quantity: 2, revenue: 700 },
      ],
      NONE
    )
    expect(r.rows[0].prevRevenue).toBe(1000)
    expect(r.rows[0].prevQuantity).toBe(3)
  })

  it('총매출 0이면 비중은 null', () => {
    const r = buildProductRanking([row({ quantity: 0, revenue: 0 })], [], NONE)
    expect(r.rows[0].share).toBeNull()
    expect(r.unmatched.share).toBeNull()
  })
})

describe('buildProductRanking — 직전 구간에만 있던 항목의 이름', () => {
  it('prevTotals 가 실어온 이름을 쓴다', () => {
    const r = buildProductRanking(
      [row({ productId: 'p1', revenue: 1000 })],
      [
        {
          optionId: 'oX',
          productId: 'pGone',
          quantity: 5,
          revenue: 5000,
          productName: '단종된 상품',
          optionName: '블랙 / L',
        },
      ],
      NONE
    )
    const gone = r.rows.find((x) => x.productId === 'pGone')!
    expect(gone.productName).toBe('단종된 상품')
    expect(gone.options[0].optionName).toBe('블랙 / L')
    expect(gone.prevRevenue).toBe(5000)
  })

  it('이름이 없으면 placeholder 로 떨어지되 "판매 없음" 문구를 쓰지 않는다', () => {
    const r = buildProductRanking(
      [row({ productId: 'p1' })],
      [{ optionId: 'oX', productId: 'pGone', quantity: 1, revenue: 100 }],
      NONE
    )
    const gone = r.rows.find((x) => x.productId === 'pGone')!
    expect(gone.productName).toBe('(이름 미상)')
  })

  it('현재 구간에도 있는 상품은 현재 이름이 유지된다', () => {
    const r = buildProductRanking(
      [row({ productId: 'p1', productName: '현재 이름', optionId: 'o1' })],
      [
        {
          optionId: 'o1',
          productId: 'p1',
          quantity: 1,
          revenue: 500,
          productName: '예전 이름',
          optionName: '예전 옵션',
        },
      ],
      NONE
    )
    expect(r.rows[0].productName).toBe('현재 이름')
    expect(r.rows[0].prevRevenue).toBe(500)
  })
})

describe('buildProductRanking — 공헌이익', () => {
  const m = (optionId: string, contributionProfit: number, unitCost = 1000) => ({
    optionId,
    cogs: 0,
    commissionFee: 0,
    shippingCost: 0,
    packagingCost: 0,
    adCost: 0,
    contributionProfit,
    unitCost,
  })

  it('상품 행은 옵션 공헌이익 합, 이익률은 매출 대비', () => {
    const r = buildProductRanking(
      [row({ optionId: 'o1', revenue: 1000 }), row({ optionId: 'o2', revenue: 3000 })],
      [],
      NONE,
      [m('o1', 200), m('o2', 600)]
    )
    expect(r.rows[0].margin?.contributionProfit).toBe(800)
    expect(r.rows[0].margin?.marginRatio).toBeCloseTo(0.2, 10)
    expect(r.rows[0].options.find((o) => o.optionId === 'o1')?.margin?.contributionProfit).toBe(200)
  })

  it('원가 없는 옵션이 섞이면 costMissing', () => {
    const r = buildProductRanking(
      [row({ optionId: 'o1', revenue: 1000 }), row({ optionId: 'o2', revenue: 1000 })],
      [],
      NONE,
      [m('o1', 200), m('o2', 900, 0)]
    )
    expect(r.rows[0].margin?.costMissing).toBe(true)
  })

  it('비용 정보가 없으면 margin 은 null', () => {
    const r = buildProductRanking([row({})], [], NONE, [])
    expect(r.rows[0].margin).toBeNull()
    expect(r.marginTotals).toBeNull()
  })

  it('합계 공헌이익은 상품 행 합 — 미매칭 매출은 분모에서 제외', () => {
    const r = buildProductRanking(
      [
        row({ productId: 'p1', optionId: 'o1', revenue: 1000 }),
        row({ productId: 'p2', optionId: 'o2', revenue: 1000 }),
      ],
      [],
      { revenue: 5000, quantity: 1 },
      [m('o1', 100), m('o2', 300)]
    )
    expect(r.marginTotals?.contributionProfit).toBe(400)
    expect(r.marginTotals?.marginRatio).toBeCloseTo(0.2, 10)
  })
})
