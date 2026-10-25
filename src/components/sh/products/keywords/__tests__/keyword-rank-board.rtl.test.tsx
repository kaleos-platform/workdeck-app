import React from 'react'
import { render, screen } from '@testing-library/react'

import { KeywordRankBoard } from '../keyword-rank-board'

const snap = (status: 'RANKED' | 'NOT_IN_TOP100' | 'FAILED', rank: number | null) => ({
  date: '2026-10-19',
  status,
  rank,
})

const payload = {
  slotLimit: 50,
  slotsUsed: 3,
  targets: [
    {
      targetKey: 'cp:a',
      kind: 'channelProduct',
      id: 'a',
      name: '쿨 브라',
      channelName: '스마트스토어',
      pageUrl: 'https://smartstore.naver.com/x/products/1',
      source: 'NAVER_SHOPPING',
      keywords: [
        { keyword: '여름브라', latest: snap('NOT_IN_TOP100', null), prev7: snap('RANKED', 30) },
        { keyword: '심리스', latest: snap('FAILED', null), prev7: null },
        { keyword: '노와이어', latest: snap('RANKED', 5), prev7: snap('RANKED', 12) },
      ],
    },
    {
      targetKey: 'ls:b',
      kind: 'listing',
      id: 'b',
      name: 'URL 없는 상품',
      channelName: '스마트스토어',
      pageUrl: null,
      source: null,
      keywords: [],
    },
  ],
}

describe('KeywordRankBoard', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload }) as never
  })

  it('슬롯·순위 문구·URL 안내를 그린다', async () => {
    render(<KeywordRankBoard />)

    expect(await screen.findByText('3/50')).toBeInTheDocument()
    expect(screen.getByText('100위 밖')).toBeInTheDocument()
    expect(screen.getByText('측정 실패')).toBeInTheDocument()
    expect(screen.getByText('5위')).toBeInTheDocument()
    expect(screen.getByText('이탈')).toBeInTheDocument()
    expect(screen.getByText('▲7')).toBeInTheDocument()
    expect(screen.getByText(/상품 페이지 URL을 연결하면 추적됩니다/)).toBeInTheDocument()
  })

  it('추적 대상이 없으면 켜는 방법을 안내한다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slotLimit: 50, slotsUsed: 0, targets: [] }),
    }) as never
    render(<KeywordRankBoard />)
    expect(await screen.findByText(/추적 중인 판매채널 상품이 없습니다/)).toBeInTheDocument()
  })
})
