import React from 'react'
import { render, screen } from '@testing-library/react'

import type { MatrixCell } from '@/lib/sh/pricing-matrix-calc'

import { PricingCostBar } from '../pricing-cost-bar'

function makeCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    discountRate: 0,
    finalPrice: 30_000,
    revenue: 27_272.73,
    cogs: 13_000,
    productionCogs: 10_000,
    marketingCogs: 3_000,
    vat: 2_727.27,
    fee: 0,
    channelFee: 0,
    paymentFee: 0,
    adCost: 0,
    shipping: 0,
    packaging: 0,
    operating: 0,
    returnCost: 0,
    totalCost: 13_000,
    netProfit: 14_272.73,
    margin: 0.4758,
    perUnitProfit: 14_272.73,
    tier: 'good',
    ...overrides,
  }
}

test('공급원가를 생산원가와 초기 마케팅비 segment로 구분한다', () => {
  render(<PricingCostBar cell={makeCell()} />)

  expect(screen.getByText('생산원가')).toBeInTheDocument()
  expect(screen.getByText('초기 마케팅비')).toBeInTheDocument()
  expect(screen.queryByText(/^원가$/)).not.toBeInTheDocument()

  const production = screen.getByLabelText('생산원가 10,000원')
  const marketing = screen.getByLabelText('초기 마케팅비 3,000원')
  const productionWidth = parseFloat(production.style.width)
  const marketingWidth = parseFloat(marketing.style.width)
  expect(productionWidth + marketingWidth).toBeCloseTo((13_000 / 30_000) * 100, 5)
})

test('초기 마케팅비가 0이면 폭이 없는 segment를 렌더하지 않는다', () => {
  render(
    <PricingCostBar
      cell={makeCell({ productionCogs: 13_000, marketingCogs: 0 })}
      showLegend={false}
    />
  )

  expect(screen.getByLabelText('생산원가 13,000원')).toBeInTheDocument()
  expect(screen.queryByLabelText('초기 마케팅비 0원')).not.toBeInTheDocument()
})
