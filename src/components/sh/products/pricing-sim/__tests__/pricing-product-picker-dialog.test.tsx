import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PricingProductPickerDialog } from '../pricing-product-picker-dialog'
import type { ResolvedComponent } from '../pricing-bundle-row'

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

afterEach(() => {
  jest.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

const initial: ResolvedComponent = {
  productId: 'product-a',
  productName: '상품 A',
  optionId: 'option-a',
  optionIds: ['option-a'],
  costPrice: 13000,
  retailPrice: 30000,
  quantity: 1,
}

test('stale 상품 응답을 무시하고 최신 상품의 원가 구성과 옵션만 confirm한다', async () => {
  const user = userEvent.setup()
  const aOptions = deferred<Response>()
  const bOptions = deferred<Response>()
  const onConfirm = jest.fn()
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/product-a/options')) return aOptions.promise
    if (url.includes('/product-b/options')) return bOptions.promise
    if (url.includes('/pricing-options')) {
      return Promise.resolve(
        response({
          data: [
            {
              optionId: 'option-b',
              optionName: '기본',
              sku: null,
              productId: 'product-b',
              productName: '상품 B',
              internalName: null,
              brandName: null,
              costPrice: 13000,
              retailPrice: 30000,
              totalStock: 1,
              msrp: null,
            },
          ],
        })
      )
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as jest.MockedFunction<typeof fetch>

  render(
    <PricingProductPickerDialog
      open
      onOpenChange={jest.fn()}
      onConfirm={onConfirm}
      initial={initial}
    />
  )

  await user.click(screen.getByRole('button', { name: '다른 상품 선택' }))
  await user.click(await screen.findByRole('button', { name: '상품 B' }))

  await act(async () => {
    bOptions.resolve(
      response({
        options: [
          {
            id: 'option-b',
            name: '기본',
            sku: null,
            costPrice: '13000',
            effectiveCostPrice: '13000',
            productionUnitCost: '10000',
            marketingUnitCost: '3000',
            retailPrice: '30000',
            sizeLabel: null,
            attributeValues: null,
            totalStock: 1,
          },
        ],
      })
    )
  })

  await user.click(await screen.findByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: '30,000원' }))

  await act(async () => {
    aOptions.resolve(
      response({
        options: [
          {
            id: 'option-a',
            name: '기본',
            sku: null,
            costPrice: '13000',
            effectiveCostPrice: '13000',
            productionUnitCost: '12000',
            marketingUnitCost: '1000',
            retailPrice: '30000',
            sizeLabel: null,
            attributeValues: null,
            totalStock: 1,
          },
        ],
      })
    )
  })

  await waitFor(() => expect(screen.getByRole('button', { name: '확인' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '확인' }))

  expect(onConfirm).toHaveBeenCalledWith({
    productId: 'product-b',
    productName: '상품 B',
    optionId: 'option-b',
    optionIds: ['option-b'],
    costPrice: 13000,
    productionUnitCost: 10000,
    marketingUnitCost: 3000,
    retailPrice: 30000,
    quantity: 1,
  })
})
