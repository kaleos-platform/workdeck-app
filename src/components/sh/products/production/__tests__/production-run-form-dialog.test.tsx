import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { ProductionRunFormDialog } from '../production-run-form-dialog'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
// Radix Select 는 jsdom 에서 조작이 번거로워 네이티브 select 로 대체
jest.mock('@/components/ui/select', () => {
  const Select = ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    disabled?: boolean
    children: ReactNode
  }) => (
    <select
      aria-label="상태"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  )
  return {
    Select,
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  }
})
jest.mock('@/components/sh/products/listings/option-picker-dialog', () => ({
  OptionPickerDialog: () => null,
}))

const baseRun = {
  id: 'run-1',
  runNo: 'R1',
  orderedConfirmedAt: '2026-11-01T00:00:00.000Z',
  stockedInAt: null as string | null,
  createdAt: '2026-10-30T00:00:00.000Z',
  totalCost: 1000,
  costMode: 'TOTAL',
  memo: null,
  sets: [],
  stockIn: null as unknown,
  items: [
    {
      id: 'i1',
      optionId: 'opt-1',
      optionName: '블랙',
      sku: null,
      productId: 'p1',
      productName: '상품',
      brandName: null,
      quantity: 50,
      stockedInQty: null as number | null,
    },
  ],
  costs: [],
}

function mockFetch(run: Record<string, unknown>) {
  const fetchMock = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith('/api/sh/inventory/locations')) {
      return {
        ok: true,
        json: async () => ({
          locations: [{ id: 'office', name: '사무실', type: 'OWN', isActive: true }],
        }),
      }
    }
    if (u.endsWith('/stockin-split')) return { ok: false, json: async () => ({}) }
    if (init?.method === 'PATCH' || init?.method === 'POST') {
      return { ok: true, json: async () => ({}) }
    }
    return { ok: true, json: async () => ({ run }) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

const renderDialog = (onSaved = jest.fn()) =>
  render(<ProductionRunFormDialog open onOpenChange={jest.fn()} runId="run-1" onSaved={onSaved} />)

describe('ProductionRunFormDialog — 입고 완료 분리', () => {
  it('상태를 입고완료로 고르면 위치 분배 입력과 사무실 입고 등록 체크가 펼쳐지고 옵션 편집이 잠긴다', async () => {
    mockFetch({ ...baseRun, status: 'ORDERED' })
    renderDialog()
    const select = await screen.findByLabelText('상태')
    expect(screen.queryByText('옵션별 보관 위치')).not.toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'STOCKED_IN' } })

    expect(await screen.findByText('옵션별 보관 위치')).toBeInTheDocument()
    expect(await screen.findByLabelText('사무실 재고에 입고 등록')).not.toBeChecked()
    expect(screen.getByLabelText('블랙 제거')).toBeDisabled()
    expect(screen.getByLabelText('발주')).toBeDisabled()
  })

  it('저장 시 PATCH(상태 없음) 후 transition(ownStockIn 포함)을 호출하고, 실패하면 사유를 보이고 재시도는 transition 만 보낸다', async () => {
    const fetchMock = mockFetch({ ...baseRun, status: 'ORDERED' })
    const onSaved = jest.fn()
    renderDialog(onSaved)
    fireEvent.change(await screen.findByLabelText('상태'), { target: { value: 'STOCKED_IN' } })
    fireEvent.click(await screen.findByLabelText('사무실 재고에 입고 등록'))

    // 첫 시도: transition 실패
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) })) // PATCH
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ message: '차수 상태가 이미 변경되었습니다' }),
    }))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(
      await screen.findByText(
        '기본 정보는 저장됐고 입고완료는 처리되지 않았습니다: 차수 상태가 이미 변경되었습니다'
      )
    ).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()

    const writes = () =>
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH' || init?.method === 'POST')
    expect(writes()).toHaveLength(2)
    const patchBody = JSON.parse(String(writes()[0][1]!.body))
    expect(patchBody).not.toHaveProperty('status')
    expect(patchBody).not.toHaveProperty('stockedInAt')
    const transitionBody = JSON.parse(String(writes()[1][1]!.body))
    expect(transitionBody).toMatchObject({
      status: 'STOCKED_IN',
      ownStockIn: true,
      allocations: [{ optionId: 'opt-1', locationId: 'office', quantity: 50 }],
    })

    // 재시도 — PATCH 재전송 없이 transition 만
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(writes()).toHaveLength(3)
    expect(String(writes()[2][0])).toContain('/transition')
  })

  const stockedRun = (canRevert: boolean) => ({
    ...baseRun,
    status: 'STOCKED_IN',
    stockedInAt: '2026-11-13T00:00:00.000Z',
    items: [{ ...baseRun.items[0], stockedInQty: 50 }],
    stockIn: {
      allocations: [
        {
          optionId: 'opt-1',
          optionName: '블랙',
          locationId: 'office',
          locationName: '사무실',
          isExternal: false,
          quantity: 50,
          state: canRevert ? 'pending' : 'registered',
          ...(canRevert ? {} : { registeredQty: 48, registeredAt: '2026-11-15T00:00:00.000Z' }),
        },
      ],
      canRevert,
      revertBlockedReason: canRevert ? null : '이 차수로 등록된 입고가 있어 되돌릴 수 없습니다',
    },
  })

  it('canRevert 이면 「발주 완료로 되돌리기」 노출, 미등록 행은 수량 입력', async () => {
    mockFetch(stockedRun(true))
    renderDialog()
    expect(await screen.findByRole('button', { name: '발주 완료로 되돌리기' })).toBeInTheDocument()
    expect(screen.getByLabelText('블랙 입고 수량')).toHaveValue(50)
    expect(screen.getByRole('button', { name: '입고 등록' })).toBeEnabled()
  })

  it('등록된 입고가 있으면 되돌리기 버튼 없이 등록됨 표시', async () => {
    mockFetch(stockedRun(false))
    renderDialog()
    expect(await screen.findByText(/등록됨 11-15/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '발주 완료로 되돌리기' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '입고 등록' })).toBeDisabled()
  })

  it('분배보다 많이 입고 등록하면 확인을 묻고, 취소하면 요청하지 않는다', async () => {
    const fetchMock = mockFetch(stockedRun(true))
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    renderDialog()
    fireEvent.change(await screen.findByLabelText('블랙 입고 수량'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: '입고 등록' }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('own-stock-in'))).toBe(false)
    confirmSpy.mockRestore()
  })

  it('입고 완료 차수는 입고완료 일자를 수정할 수 없다', async () => {
    mockFetch(stockedRun(true))
    renderDialog()
    expect(await screen.findByLabelText('입고완료 일자')).toBeDisabled()
  })
})
