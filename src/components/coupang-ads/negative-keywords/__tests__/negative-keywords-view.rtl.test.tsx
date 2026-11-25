import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { NegativeKeywordsView } from '../negative-keywords-view'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))

const cand = (keyword: string) => ({
  keyword,
  adCost30: 20000,
  clicks30: 15,
  orders30: 0,
  lastSpendDate: '2026-11-20',
})
const data = {
  rules: { WINDOW_DAYS: 30, MIN_AD_COST: 10000, MIN_CLICKS: 10, PROTECT_DAYS: 90 },
  period: { start: '2026-10-26', end: '2026-11-24' },
  spendingAfterRemoval: [],
  campaigns: [
    {
      campaignId: 'c1',
      campaignName: '캠페인A',
      removedCount: 0,
      candidates: [cand('가'), cand('나')],
      protected: [
        { ...cand('보호어'), orders90: 2, revenue90: 50000, adCost90: 25000, roas90: 200 },
      ],
    },
    {
      campaignId: 'c2',
      campaignName: '캠페인B',
      removedCount: 1,
      candidates: [cand('다')],
      protected: [],
    },
  ],
}

let fetchMock: jest.Mock
beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => data })
  global.fetch = fetchMock as unknown as typeof fetch
})

async function ready() {
  render(<NegativeKeywordsView />)
  await screen.findByText('캠페인A')
}

describe('NegativeKeywordsView', () => {
  it('다른 카드에서 체크하면 이전 카드 선택이 해제된다', async () => {
    await ready()
    fireEvent.click(screen.getByLabelText('가 선택'))
    expect(screen.getByLabelText('가 선택')).toBeChecked()
    fireEvent.click(screen.getByLabelText('다 선택'))
    expect(screen.getByLabelText('다 선택')).toBeChecked()
    expect(screen.getByLabelText('가 선택')).not.toBeChecked()
  })

  it('보호 키워드는 체크박스가 없다', async () => {
    await ready()
    expect(screen.getByText('보호어')).toBeInTheDocument()
    expect(screen.queryByLabelText('보호어 선택')).toBeNull()
  })

  it('클립보드 실패 시 제거 POST 를 호출하지 않는다', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    })
    await ready()
    fireEvent.click(screen.getByLabelText('가 선택'))
    fireEvent.click(
      within(screen.getByTestId('campaign-c1')).getByRole('button', { name: /제거 후 복사/ })
    )
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('가'))
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it('복사 성공 시 remove POST 후 목록에서 빠진다', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } })
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: true, json: async () => ({ success: true, count: 1, removedAt: 'T' }) }
        : { ok: true, json: async () => data }
    )
    await ready()
    fireEvent.click(screen.getByLabelText('가 선택'))
    fireEvent.click(
      within(screen.getByTestId('campaign-c1')).getByRole('button', { name: /제거 후 복사/ })
    )
    await waitFor(() => expect(screen.queryByLabelText('가 선택')).toBeNull())
  })
})
