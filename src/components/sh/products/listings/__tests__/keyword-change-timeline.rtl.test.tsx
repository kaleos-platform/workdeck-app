// 변경 이력 "효과 보기" — 관찰 기간이 아직 없을 때 뒤집힌 기간을 보여주지 않는다.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { KeywordChangeTimeline } from '../keyword-change-timeline'

const log = {
  id: 'log1',
  listingId: null,
  channelProductId: 'cp1',
  productId: null,
  beforeName: '옛 이름',
  afterName: '새 이름',
  beforeKeywords: [],
  afterKeywords: [],
  reason: null,
  reasonNote: null,
  observeMetric: null,
  multiChange: false,
  actorUserId: null,
  createdAt: '2026-10-18T13:35:00.000Z',
}

function mockFetch(after: { from: string; to: string; observedDays: number }) {
  global.fetch = jest.fn((url: string) => {
    const body = url.includes('/effect')
      ? {
          label: '이 구성 옵션의 무신사 채널 전체 판매',
          before: { from: '2026-10-04', to: '2026-10-17', quantity: 10, revenue: 100000 },
          after: { ...after, quantity: 5, revenue: 50000, complete: false },
          ranks: [],
        }
      : { data: [log], total: 1 }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }) as unknown as typeof fetch
}

async function openEffect() {
  const user = userEvent.setup()
  render(<KeywordChangeTimeline channelProductId="cp1" />)
  await user.click(await screen.findByRole('button', { name: /효과 보기/ }))
}

it('관찰 기간이 0일이면 기간 대신 "관찰 전"을 보여준다', async () => {
  mockFetch({ from: '2026-10-19', to: '2026-10-18', observedDays: 0 })
  await openEffect()
  expect(await screen.findByText('변경 후 (관찰 전)')).toBeInTheDocument()
  expect(screen.queryByText(/2026-10-19~2026-10-18/)).not.toBeInTheDocument()
  expect(screen.getByText(/변경 다음 날부터 14일 동안 관찰합니다/)).toBeInTheDocument()
})

it('관찰 중이면 기간과 진행 일수를 보여준다', async () => {
  mockFetch({ from: '2026-10-13', to: '2026-10-18', observedDays: 6 })
  await openEffect()
  expect(await screen.findByText('변경 후 (2026-10-13~2026-10-18)')).toBeInTheDocument()
  expect(screen.getByText('관찰 중 6/14일')).toBeInTheDocument()
})
