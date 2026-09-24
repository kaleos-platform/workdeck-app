import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ProductOptionsTable } from '../product-options-table'

afterEach(() => {
  jest.restoreAllMocks()
})

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

test('생산차수 연동 요약과 공급원가 안내에 원가 구성을 표시한다', async () => {
  const user = userEvent.setup()
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(
      response({
        product: {
          id: 'product-1',
          code: 'P001',
          optionAttributes: [],
          options: [],
        },
      })
    )
    .mockResolvedValueOnce(
      response({
        options: [
          {
            id: 'option-1',
            name: '기본',
            sku: 'P001',
            costPrice: 13_000,
            retailPrice: 30_000,
            attributeValues: {},
            totalStock: 10,
          },
        ],
        productionCost: {
          productionUnitCost: 10_000,
          marketingUnitCost: 3_000,
          totalUnitCost: 13_000,
          unitCost: 13_000,
          runCount: 2,
        },
        useProductionCost: true,
      })
    ) as jest.MockedFunction<typeof fetch>

  render(<ProductOptionsTable productId="product-1" />)

  expect(
    await screen.findByText(
      '완료 2개 차수 가중평균 · 생산원가 10,000원 + 초기 마케팅비 3,000원 = 공급원가 13,000원'
    )
  ).toBeInTheDocument()

  await user.hover(screen.getByRole('button', { name: '공급원가 구성 안내' }))
  expect(
    (await screen.findAllByText('생산원가 10,000원 + 초기 마케팅비 3,000원 = 공급원가 13,000원'))
      .length
  ).toBeGreaterThan(0)
})
