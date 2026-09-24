import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ProductionRunFormDialog, type PrefillItem } from '../production-run-form-dialog'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/components/sh/products/listings/option-picker-dialog', () => ({
  OptionPickerDialog: () => null,
}))

type CostMode = 'TOTAL' | 'BREAKDOWN'

const products = [
  {
    id: 'i1',
    optionId: 'o1',
    optionName: '상품 A 기본',
    sku: 'A-1',
    productId: 'p1',
    productName: '상품 A',
    brandName: null,
    quantity: 1000,
    stockedInQty: null,
  },
  {
    id: 'i2',
    optionId: 'o2',
    optionName: '상품 B 기본',
    sku: 'B-1',
    productId: 'p2',
    productName: '상품 B',
    brandName: null,
    quantity: 500,
    stockedInQty: null,
  },
]

function detail(costMode: CostMode = 'TOTAL', overrides: Record<string, unknown> = {}) {
  return {
    run: {
      id: 'run-1',
      runNo: 'RUN-001',
      status: 'PLANNED',
      orderedConfirmedAt: null,
      stockedInAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      totalCost: 3_000_000,
      costMode,
      memo: null,
      items: products,
      costs: [
        {
          id: 'c1',
          itemName: '체험단',
          description: null,
          spec: null,
          quantity: 1,
          unitPrice: 3_000_000,
          amount: 3_000_000,
          note: null,
          sortOrder: 0,
          vatIncluded: true,
          category: 'MARKETING',
          targetProductId: 'p1',
        },
      ],
      ...overrides,
    },
  }
}

function mockEditFetch(data = detail()) {
  const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (!init) return { ok: true, json: async () => data } as Response
    return { ok: true, json: async () => ({}) } as Response
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function renderEdit() {
  return render(
    <ProductionRunFormDialog open onOpenChange={jest.fn()} runId="run-1" onSaved={jest.fn()} />
  )
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: option })).not.toBeInTheDocument()
  )
}

describe('생산 차수 원가 입력', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('편집 상세의 마케팅 대상을 복원하고 대상 상품 제거 후 저장을 막는다', async () => {
    const user = userEvent.setup()
    const fetchMock = mockEditFetch()
    renderEdit()

    expect(await screen.findByDisplayValue('체험단')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '비용 분류' })).toHaveTextContent('마케팅')
    expect(screen.getByRole('combobox', { name: '대상 상품' })).toHaveTextContent('상품 A')

    await user.click(screen.getByRole('button', { name: '상품 A 전체 제거' }))
    await user.click(screen.getByRole('button', { name: '수정' }))

    expect(
      screen.getByText('마케팅 비용의 대상 상품이 생산 차수에 포함되어 있지 않습니다')
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '대상 상품' })).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  })

  test('단일 상품에서 마케팅 분류를 선택하면 대상을 자동 선택하고 비활성화한다', async () => {
    const user = userEvent.setup()
    const prefillItems: PrefillItem[] = [
      {
        optionId: 'o1',
        optionName: '기본',
        sku: null,
        productId: 'p1',
        productName: '상품 A',
        brandName: null,
        quantity: 10,
      },
    ]
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ runNo: 'RUN-002' }) })
    render(
      <ProductionRunFormDialog
        open
        onOpenChange={jest.fn()}
        onSaved={jest.fn()}
        prefillItems={prefillItems}
      />
    )

    await screen.findByDisplayValue('RUN-002')
    await choose(user, '비용 분류', '마케팅')

    expect(screen.getByRole('combobox', { name: '대상 상품' })).toHaveTextContent('상품 A')
    expect(screen.getByRole('combobox', { name: '대상 상품' })).toBeDisabled()
  })

  test('다상품 신규 행은 대상 placeholder를 보이고 선택한 상품을 payload에 보낸다', async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return { ok: true, json: async () => ({ runNo: 'RUN-003' }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const prefillItems: PrefillItem[] = products.map((item) => ({
      optionId: item.optionId,
      optionName: item.optionName,
      sku: item.sku,
      productId: item.productId,
      productName: item.productName,
      brandName: item.brandName,
      quantity: item.quantity,
    }))
    render(
      <ProductionRunFormDialog
        open
        onOpenChange={jest.fn()}
        onSaved={jest.fn()}
        prefillItems={prefillItems}
      />
    )

    await screen.findByDisplayValue('RUN-003')
    await user.type(screen.getByPlaceholderText('예: 원단, 부자재, 가공비'), '체험단')
    await user.type(screen.getByPlaceholderText('0'), '3000000')
    await choose(user, '비용 분류', '마케팅')
    expect(screen.getByRole('combobox', { name: '대상 상품' })).toHaveTextContent('대상 상품 선택')
    await choose(user, '대상 상품', '상품 B')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
    )
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    const payload = JSON.parse(String(postCall?.[1]?.body))
    expect(payload.costs[0]).toEqual(
      expect.objectContaining({ category: 'MARKETING', targetProductId: 'p2' })
    )
  })

  test.each<CostMode>(['TOTAL', 'BREAKDOWN'])(
    '%s 모드에서 마케팅 대상을 payload에 포함한다',
    async (mode) => {
      const user = userEvent.setup()
      const fetchMock = mockEditFetch(detail(mode))
      renderEdit()

      expect(await screen.findByDisplayValue('체험단')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '수정' }))

      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true)
      )
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      const payload = JSON.parse(String(patchCall?.[1]?.body))
      expect(payload.costs[0]).toEqual(
        expect.objectContaining({ category: 'MARKETING', targetProductId: 'p1' })
      )
    }
  )

  test('다상품 마케팅 행은 대상 선택을 요구하고 분류 변경 시 target을 null로 정규화한다', async () => {
    const user = userEvent.setup()
    const fetchMock = mockEditFetch(
      detail('TOTAL', {
        costs: [
          {
            ...detail().run.costs[0],
            targetProductId: null,
          },
        ],
      })
    )
    renderEdit()

    await screen.findByDisplayValue('체험단')
    expect(screen.getByRole('combobox', { name: '대상 상품' })).toHaveTextContent('대상 상품 선택')
    await user.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByText('마케팅 비용의 대상 상품을 선택하세요')).toBeInTheDocument()

    await choose(user, '대상 상품', '상품 B')
    await choose(user, '비용 분류', '기타')
    await user.click(screen.getByRole('button', { name: '수정' }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true)
    )
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const payload = JSON.parse(String(patchCall?.[1]?.body))
    expect(payload.costs[0].targetProductId).toBeNull()
  })

  test('입고완료 실제 수량이 0이면 계획 수량으로 fallback하지 않는다', async () => {
    mockEditFetch(
      detail('TOTAL', {
        status: 'STOCKED_IN',
        items: products.map((item) => ({ ...item, stockedInQty: 0 })),
        costs: [
          {
            ...detail().run.costs[0],
            category: 'OTHER',
            targetProductId: null,
          },
        ],
      })
    )
    renderEdit()

    expect(
      await screen.findByText('실제 입고수량이 0개라 원가를 배분할 수 없습니다')
    ).toBeInTheDocument()
  })
})
