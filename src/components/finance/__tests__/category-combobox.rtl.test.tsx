// CategoryCombobox 환불 탭(refundType) 검증 (RTL + jsdom)
// 기본 탭은 거래 방향 기준, 반대 타입 탭(환불)도 선택 가능 + 안내 문구.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CategoryCombobox } from '../category-combobox'
import type { ComboOption } from '@/lib/finance/category-options'

// cmdk(Command)가 ResizeObserver를 요구 — jsdom 미제공이라 스텁.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub

const OPTIONS: ComboOption[] = [
  { id: 'inc', label: '기타수입', type: 'INCOME', keywords: ['기타수입', '수익'] },
  { id: 'exp', label: '금융비용', type: 'EXPENSE', keywords: ['금융비용', '비용'] },
  { id: 'trf', label: '계좌간 이체', type: 'TRANSFER', keywords: ['계좌간 이체', '이체'] },
]

function renderCombo(refundType: 'INCOME' | 'EXPENSE' | null) {
  return render(
    <CategoryCombobox
      options={OPTIONS}
      value={null}
      onChange={() => {}}
      groupByType
      defaultType={refundType === 'INCOME' ? 'EXPENSE' : 'INCOME'}
      refundType={refundType}
      placeholder="분류"
    />
  )
}

describe('CategoryCombobox 환불 탭', () => {
  test('OUT(지출): 기본 탭=비용, 수익 탭에서 일반 수익 계정 선택 가능 + 환불 안내', async () => {
    const user = userEvent.setup()
    renderCombo('INCOME')
    await user.click(screen.getByRole('button', { name: '분류' }))

    // 기본 탭=비용
    expect(screen.getByText('금융비용')).toBeInTheDocument()
    expect(screen.queryByText('기타수입')).not.toBeInTheDocument()
    expect(screen.queryByText(/그 수입에서 차감됩니다/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '수익' }))
    expect(screen.getByText('기타수입')).toBeInTheDocument()
    expect(
      screen.getByText(/출금\(고객 환불\)을 수익 계정에 분류하면 그 수입에서 차감됩니다/)
    ).toBeInTheDocument()
  })

  test('IN(수입): 기본 탭=수익, 비용 탭에서 일반 비용 계정 선택 가능 + 환불 안내', async () => {
    const user = userEvent.setup()
    renderCombo('EXPENSE')
    await user.click(screen.getByRole('button', { name: '분류' }))
    expect(screen.getByText('기타수입')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '비용' }))
    expect(screen.getByText('금융비용')).toBeInTheDocument()
    expect(
      screen.getByText(/입금\(환불\)을 비용 계정에 분류하면 그 비용에서 차감됩니다/)
    ).toBeInTheDocument()
  })

  test('제한 없음(refundType=null): 안내 없음', async () => {
    const user = userEvent.setup()
    renderCombo(null)
    await user.click(screen.getByRole('button', { name: '분류' }))
    await user.click(screen.getByRole('button', { name: '비용' }))
    expect(screen.queryByText(/에서 차감됩니다/)).not.toBeInTheDocument()
  })

  test('OUT 거래에 이미 수익 계정이 분류돼 있으면 재오픈 시 수익 탭으로 열림', async () => {
    const user = userEvent.setup()
    render(
      <CategoryCombobox
        options={OPTIONS}
        value="inc"
        onChange={() => {}}
        groupByType
        defaultType="EXPENSE"
        refundType="INCOME"
        placeholder="분류"
      />
    )
    await user.click(screen.getByRole('button', { name: '기타수입' }))
    expect(screen.getByRole('option', { name: /기타수입/ })).toBeInTheDocument()
    expect(screen.queryByText('금융비용')).not.toBeInTheDocument()
  })
})
