import React from 'react'
import { render, screen, within } from '@testing-library/react'
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

test('생산차수 연동이 꺼져 있으면 tooltip에서 breakdown을 숨기고 수동 원가를 유지한다', async () => {
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
            costPrice: 9_000,
            effectiveCostPrice: 9_000,
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
        useProductionCost: false,
      })
    ) as jest.MockedFunction<typeof fetch>

  render(<ProductOptionsTable productId="product-1" />)

  expect(await screen.findByDisplayValue('9000')).toBeEnabled()
  await user.hover(screen.getByRole('button', { name: '공급원가 구성 안내' }))

  const tooltip = await screen.findByRole('tooltip')
  expect(
    within(tooltip).queryByText('생산원가 10,000원 + 초기 마케팅비 3,000원 = 공급원가 13,000원')
  ).not.toBeInTheDocument()
})

test('원가 구성의 표시 정수 합계를 공급원가 표시값과 맞춘다', async () => {
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
            costPrice: 66.666,
            retailPrice: 100,
            attributeValues: {},
            totalStock: 10,
          },
        ],
        productionCost: {
          productionUnitCost: 33.333,
          marketingUnitCost: 33.333,
          totalUnitCost: 66.666,
          unitCost: 66.666,
          runCount: 1,
        },
        useProductionCost: true,
      })
    ) as jest.MockedFunction<typeof fetch>

  render(<ProductOptionsTable productId="product-1" />)

  expect(
    await screen.findByText(
      '완료 1개 차수 가중평균 · 생산원가 33원 + 초기 마케팅비 34원 = 공급원가 67원'
    )
  ).toBeInTheDocument()
})
