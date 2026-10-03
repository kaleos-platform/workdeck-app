// CategoryCombobox 방향 가드(blockType) 검증 (RTL + jsdom)
// OUT(지출) 거래에서 '수익' 탭 비활성 + 수익 항목이 목록/검색에서 제외되는지 확인.

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

function renderCombo(blockType: 'INCOME' | 'EXPENSE' | null) {
  return render(
    <CategoryCombobox
      options={OPTIONS}
      value={null}
      onChange={() => {}}
      groupByType
      defaultType={blockType === 'INCOME' ? 'EXPENSE' : 'INCOME'}
      blockType={blockType}
      placeholder="분류"
    />
  )
}

describe('CategoryCombobox 방향 가드', () => {
  test('OUT(지출): 수익 탭 비활성 + 수익 항목 숨김, 비용/이체는 선택 가능', async () => {
    const user = userEvent.setup()
    renderCombo('INCOME')
    await user.click(screen.getByRole('button', { name: '분류' }))

    // 수익 탭 비활성
    const incomeTab = screen.getByRole('button', { name: '수익' })
    expect(incomeTab).toBeDisabled()
    // 비용/이체 탭 활성
    expect(screen.getByRole('button', { name: '비용' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '이체' })).toBeEnabled()

    // 기본 탭=비용 → 금융비용 노출, 수익 항목(기타수입)은 목록에 없음
    expect(screen.getByText('금융비용')).toBeInTheDocument()
    expect(screen.queryByText('기타수입')).not.toBeInTheDocument()
  })

  test('OUT(지출): 검색으로도 수익 항목 선택 불가(교차검색 우회 차단)', async () => {
    const user = userEvent.setup()
    renderCombo('INCOME')
    await user.click(screen.getByRole('button', { name: '분류' }))
    await user.type(screen.getByPlaceholderText('검색...'), '기타')
    // 검색해도 수익 항목은 제외됨
    expect(screen.queryByText('기타수입')).not.toBeInTheDocument()
  })

  test('IN(수입): 비용 탭 비활성, 수익 선택 가능', async () => {
    const user = userEvent.setup()
    renderCombo('EXPENSE')
    await user.click(screen.getByRole('button', { name: '분류' }))
    expect(screen.getByRole('button', { name: '비용' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '수익' })).toBeEnabled()
    expect(screen.getByText('기타수입')).toBeInTheDocument()
    expect(screen.queryByText('금융비용')).not.toBeInTheDocument()
  })

  test('제한 없음(blockType=null): 세 탭 모두 활성', async () => {
    const user = userEvent.setup()
    renderCombo(null)
    await user.click(screen.getByRole('button', { name: '분류' }))
    expect(screen.getByRole('button', { name: '수익' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '비용' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '이체' })).toBeEnabled()
  })
})

describe('CategoryCombobox 차감 계정', () => {
  const WITH_CONTRA: ComboOption[] = [
    ...OPTIONS,
    { id: 'ref', label: '매출환입', type: 'INCOME', isContra: true, keywords: ['매출환입'] },
    { id: 'ret', label: '매입환출', type: 'EXPENSE', isContra: true, keywords: ['매입환출'] },
  ]

  test('OUT(지출): 수익 탭이 열리고 매출환입만 노출, 비용 탭에서 매입환출은 숨김', async () => {
    const user = userEvent.setup()
    render(
      <CategoryCombobox
        options={WITH_CONTRA}
        value={null}
        onChange={() => {}}
        groupByType
        defaultType="EXPENSE"
        blockType="INCOME"
        placeholder="분류"
      />
    )
    await user.click(screen.getByRole('button', { name: '분류' }))
    expect(screen.getByText('금융비용')).toBeInTheDocument()
    expect(screen.queryByText('매입환출')).not.toBeInTheDocument()

    const incomeTab = screen.getByRole('button', { name: '수익' })
    expect(incomeTab).toBeEnabled()
    await user.click(incomeTab)
    expect(screen.getByText('매출환입')).toBeInTheDocument()
    expect(screen.queryByText('기타수입')).not.toBeInTheDocument()
  })
})

test('OUT 거래에 이미 매출환입이 분류돼 있으면 재오픈 시 수익 탭으로 열림', async () => {
  const user = userEvent.setup()
  render(
    <CategoryCombobox
      options={[
        ...OPTIONS,
        { id: 'ref', label: '매출환입', type: 'INCOME', isContra: true, keywords: ['매출환입'] },
      ]}
      value="ref"
      onChange={() => {}}
      groupByType
      defaultType="EXPENSE"
      blockType="INCOME"
      placeholder="분류"
    />
  )
  await user.click(screen.getByRole('button', { name: '매출환입' }))
  expect(screen.getByRole('option', { name: /매출환입/ })).toBeInTheDocument()
  expect(screen.queryByText('금융비용')).not.toBeInTheDocument()
})
