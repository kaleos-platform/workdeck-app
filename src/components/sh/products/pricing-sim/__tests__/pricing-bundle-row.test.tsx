import React from 'react'
import { render, screen } from '@testing-library/react'

import { BundleRow, type ResolvedComponent } from '../pricing-bundle-row'

const component: ResolvedComponent = {
  productId: 'product-1',
  productName: '테스트 상품',
  optionId: 'option-1',
  optionIds: ['option-1'],
  costPrice: 13_000,
  productionUnitCost: 10_000,
  marketingUnitCost: 3_000,
  retailPrice: 30_000,
  quantity: 1,
}

function renderRow(resolved: ResolvedComponent) {
  render(
    <BundleRow
      rowId="row-1"
      rowIndex={0}
      resolved={resolved}
      onChange={jest.fn()}
      onRemove={jest.fn()}
      showRemove={false}
    />
  )
}

test('총원가를 유지하면서 초기 마케팅비가 있는 원가 구성을 보조 표시한다', () => {
  renderRow(component)

  expect(screen.getByText('13,000원')).toBeInTheDocument()
  expect(
    screen.getByText('생산원가 10,000원 + 초기 마케팅비 3,000원 = 공급원가 13,000원')
  ).toBeInTheDocument()
})

test('구 snapshot처럼 원가 구성값이 없으면 보조 표시를 생략한다', () => {
  renderRow({
    ...component,
    productionUnitCost: undefined,
    marketingUnitCost: undefined,
  })

  expect(screen.getByText('13,000원')).toBeInTheDocument()
  expect(screen.queryByText(/초기 마케팅비/)).not.toBeInTheDocument()
})

test('초기 마케팅비가 0이면 보조 표시를 생략한다', () => {
  renderRow({
    ...component,
    productionUnitCost: 13_000,
    marketingUnitCost: 0,
  })

  expect(screen.queryByText(/초기 마케팅비/)).not.toBeInTheDocument()
})
