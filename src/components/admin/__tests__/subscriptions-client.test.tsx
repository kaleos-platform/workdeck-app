import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SubscriptionsClient } from '../subscriptions-client'

const trial = {
  spaceId: 's1',
  spaceName: '테스트 Space',
  owners: [{ id: 'u1', email: 'owner@test.dev', name: null }],
  deckAppId: 'finance',
  deckName: '재무',
  pricingMode: 'SUBSCRIPTION',
  accessReason: 'TRIAL',
  trialEndsAt: '2099-12-01T15:00:00.000Z',
  currentPeriodEnd: null,
  subscriptionStatus: null,
  itemStatus: null,
  spaceExempt: true,
  exemptFlag: false,
  exemptNote: null,
  canExtendTrial: true,
}
const payload = {
  rows: [
    trial,
    {
      ...trial,
      deckAppId: 'sales',
      deckName: '매출',
      accessReason: 'SUBSCRIBED',
      canExtendTrial: false,
    },
  ],
  spaces: [
    {
      id: 's1',
      name: '테스트 Space',
      owners: trial.owners,
      exemptFlag: true,
      exemptNote: '전체 면제',
    },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload })
})

async function expandTestSpace() {
  fireEvent.click(await screen.findByRole('button', { name: '테스트 Space 업무 펼치기' }))
}

test('Space와 소유자 링크, 전체 면제 상속 및 연장 가능한 덱만 표시한다', async () => {
  render(<SubscriptionsClient />)
  expect((await screen.findAllByRole('link', { name: 'owner@test.dev' }))[0]).toHaveAttribute(
    'href',
    '/admin/users/u1'
  )
  await expandTestSpace()
  expect(screen.getAllByText('전체 Space 면제 적용')[0]).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '재무 체험 연장' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '매출 체험 연장' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Space·소유자 검색'), { target: { value: '없음' } })
  expect(screen.getByText('검색 조건에 맞는 구독이 없습니다')).toBeInTheDocument()
})

test('체험 연장은 사유를 검증하고 선택 날짜를 API에 전달한다', async () => {
  render(<SubscriptionsClient />)
  await expandTestSpace()
  fireEvent.click(await screen.findByRole('button', { name: '재무 체험 연장' }))
  fireEvent.click(screen.getByRole('button', { name: '+7일' }))
  expect(screen.getByLabelText('체험 종료일 (KST)')).toHaveValue('2099-12-08')
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('변경 사유를 입력하세요')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '고객 지원' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/subscriptions/s1/finance',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ trialEndsOn: '2099-12-08', note: '고객 지원' }),
      })
    )
  )
})

test('덱 면제와 전체 Space 면제를 각각 다른 endpoint로 변경한다', async () => {
  render(<SubscriptionsClient />)
  await expandTestSpace()
  fireEvent.click(await screen.findByRole('switch', { name: '테스트 Space 재무 덱 면제' }))
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '덱 지원' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/subscriptions/s1/finance',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ exempt: true, note: '덱 지원' }),
      })
    )
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('switch', { name: '테스트 Space 전체 Space 면제' }))
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '전체 해제' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/billing/spaces/s1/exempt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ exempt: false, note: '전체 해제' }),
      })
    )
  )
})

test('불러오기 실패 후 다시 시도할 수 있다', async () => {
  jest.mocked(fetch).mockRejectedValueOnce(new Error('일시적인 오류'))
  render(<SubscriptionsClient />)
  expect(await screen.findByRole('alert')).toHaveTextContent('일시적인 오류')
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(
    await screen.findByRole('button', { name: '테스트 Space 업무 펼치기' })
  ).toBeInTheDocument()
})

test('유효한 유료 항목만 결제 기한을 표시하고 미구독·면제 업무는 숨긴다', async () => {
  const base = {
    ...trial,
    trialEndsAt: null,
    currentPeriodEnd: '2099-12-15T03:00:00Z',
    spaceExempt: false,
    exemptFlag: false,
    canExtendTrial: false,
  }
  const variants = [
    { deckName: '유료 정상', subscriptionStatus: 'ACTIVE', itemStatus: 'ACTIVE' },
    {
      deckName: '유료 해지예약',
      subscriptionStatus: 'PAST_DUE',
      itemStatus: 'CANCEL_AT_PERIOD_END',
    },
    { deckName: '미구독 체험', subscriptionStatus: 'ACTIVE', itemStatus: null },
    { deckName: '종료된 업무', subscriptionStatus: 'ACTIVE', itemStatus: 'ENDED' },
    { deckName: '종료된 구독', subscriptionStatus: 'EXPIRED', itemStatus: 'ACTIVE' },
    {
      deckName: '개별면제업무',
      subscriptionStatus: 'ACTIVE',
      itemStatus: 'ACTIVE',
      exemptFlag: true,
    },
    {
      deckName: '상속면제업무',
      subscriptionStatus: 'ACTIVE',
      itemStatus: 'ACTIVE',
      spaceExempt: true,
    },
  ]
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      rows: variants.map((row, index) => ({ ...base, ...row, deckAppId: `deck-${index}` })),
      spaces: payload.spaces,
    }),
  } as Response)
  render(<SubscriptionsClient />)
  await expandTestSpace()
  await screen.findByRole('row', { name: /유료 정상/ })
  for (const variant of variants) {
    const row = screen.getByRole('row', { name: new RegExp(variant.deckName) })
    expect(within(row).getAllByRole('cell')[4].textContent).toBe(
      variant.deckName.startsWith('유료') ? '2099-12-15' : '-'
    )
  }
})

test('Space별로 업무를 접어 표시하고 펼치기와 전체 접기를 제공한다', async () => {
  render(<SubscriptionsClient />)
  const expand = await screen.findByRole('button', { name: '테스트 Space 업무 펼치기' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: '재무 체험 연장' })).not.toBeInTheDocument()
  expect(screen.getByText('1개 Space · 2개 업무')).toBeInTheDocument()
  fireEvent.click(expand)
  expect(screen.getByRole('button', { name: '재무 체험 연장' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '전체 접기' }))
  expect(screen.queryByRole('button', { name: '재무 체험 연장' })).not.toBeInTheDocument()
})

test('업무 없는 Space도 소유자로 검색하고 전체 면제를 같은 표에서 관리한다', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      rows: [],
      spaces: [
        {
          id: 'empty',
          name: '빈 공간',
          owners: [{ id: 'empty-owner', email: 'empty@test.dev', name: null }],
          exemptFlag: false,
          exemptNote: null,
        },
      ],
    }),
  } as Response)
  render(<SubscriptionsClient />)
  const owner = await screen.findByRole('link', { name: 'empty@test.dev' })
  expect(owner).toHaveAttribute('href', '/admin/users/empty-owner')
  expect(screen.getByText('업무 없음')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '전체 펼치기' }))
  expect(screen.getByRole('button', { name: '빈 공간 업무 펼치기' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  fireEvent.change(screen.getByLabelText('Space·소유자 검색'), {
    target: { value: 'empty@test.dev' },
  })
  expect(screen.getByText('1개 Space · 0개 업무')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '빈 공간 전체 Space 면제' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '전체 Space 면제' })).not.toBeInTheDocument()
})

test('업무 필터는 일치하는 그룹만 자동으로 펼치고 전체 면제 범위를 명시한다', async () => {
  render(<SubscriptionsClient />)
  await screen.findByRole('button', { name: '테스트 Space 업무 펼치기' })
  fireEvent.change(screen.getByLabelText('업무 필터'), { target: { value: 'finance' } })
  expect(screen.getByRole('button', { name: '테스트 Space 업무 접기' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(screen.getByRole('button', { name: '재무 체험 연장' })).toBeInTheDocument()
  expect(
    screen.queryByRole('switch', { name: '테스트 Space 매출 덱 면제' })
  ).not.toBeInTheDocument()
  expect(screen.getByText('1개 Space · 1개 업무')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: '테스트 Space 전체 Space 면제' }))
  expect(screen.getByText(/필터와 관계없이 이 Space의 모든 업무에 적용/)).toBeInTheDocument()
})

test('상태·소유자 조건을 같은 그룹에 적용하고 필터 초기화로 빈 Space를 복원한다', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      rows: [
        ...payload.rows,
        {
          ...trial,
          spaceId: 's2',
          spaceName: '다른 공간',
          owners: [{ id: 'u2', email: 'other@test.dev', name: null }],
          deckAppId: 'other',
          deckName: '다른 업무',
          accessReason: 'SUBSCRIBED',
        },
      ],
      spaces: [
        ...payload.spaces,
        {
          id: 's2',
          name: '다른 공간',
          owners: [{ id: 'u2', email: 'other@test.dev', name: null }],
          exemptFlag: false,
          exemptNote: null,
        },
        { id: 'empty', name: '빈 공간', owners: [], exemptFlag: false, exemptNote: null },
      ],
    }),
  } as Response)
  render(<SubscriptionsClient />)
  await screen.findByText('3개 Space · 3개 업무')
  fireEvent.change(screen.getByLabelText('상태 필터'), { target: { value: 'TRIAL' } })
  expect(screen.getByText('1개 Space · 1개 업무')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '다른 공간' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '빈 공간' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Space·소유자 검색'), {
    target: { value: ' OWNER@TEST.DEV ' },
  })
  expect(screen.getByRole('button', { name: '재무 체험 연장' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '테스트 Space 업무 접기' }))
  fireEvent.change(screen.getByLabelText('업무 필터'), { target: { value: 'finance' } })
  expect(screen.getByRole('button', { name: '테스트 Space 업무 접기' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
  expect(screen.getByText('3개 Space · 3개 업무')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '빈 공간' })).toBeInTheDocument()
})
