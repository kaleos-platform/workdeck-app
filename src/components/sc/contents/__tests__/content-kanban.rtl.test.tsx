// ContentKanban 컴포넌트 렌더링 + DOM 동작 검증 (RTL + jsdom)
// 순수 로직 테스트(bucketByColumn)는 content-kanban.test.tsx 에 분리 유지

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContentKanban, type KanbanContentRow } from '../content-kanban'

// ---- next/navigation mock ----
// jest.mock 팩토리 내에서 변수를 참조하려면 반드시 'mock' 접두사 필요 (hoisting 규칙)
const mockPush = jest.fn()
const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

// ---- 헬퍼 ----
function makeContent(
  overrides: Partial<KanbanContentRow> & {
    id: string
    title: string
    status: KanbanContentRow['status']
  }
): KanbanContentRow {
  return {
    updatedAt: new Date('2026-01-15T10:00:00Z'),
    channel: null,
    ...overrides,
  }
}

// ---- 테스트 픽스처 ----
const EMPTY_CONTENTS: KanbanContentRow[] = []

const SAMPLE_CONTENTS: KanbanContentRow[] = [
  makeContent({ id: '1', title: '기획안 A', status: 'TODO' }),
  makeContent({ id: '2', title: '초안 B', status: 'DRAFT' }),
  makeContent({ id: '3', title: '발행됨 C', status: 'PUBLISHED' }),
]

// ---- 공통 setup ----
beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
})

// ================================================================
// 1. 빈 보드 렌더
// ================================================================
describe('ContentKanban — 빈 보드', () => {
  it('5개 컬럼 헤더가 모두 표시된다', () => {
    render(<ContentKanban contents={EMPTY_CONTENTS} />)
    expect(screen.getByText('TO-DO')).toBeInTheDocument()
    expect(screen.getByText('작성')).toBeInTheDocument()
    expect(screen.getByText('리뷰')).toBeInTheDocument()
    expect(screen.getByText('배포')).toBeInTheDocument()
    expect(screen.getByText('분석')).toBeInTheDocument()
  })

  it('TO-DO 컬럼 placeholder가 표시된다', () => {
    render(<ContentKanban contents={EMPTY_CONTENTS} />)
    expect(screen.getByText('아이데이션에서 토픽을 보내주세요')).toBeInTheDocument()
  })

  it('각 컬럼 카드 카운트가 0이다', () => {
    render(<ContentKanban contents={EMPTY_CONTENTS} />)
    // 카운트 숫자 '0' 이 5개 존재해야 함
    const zeros = screen.getAllByText('0')
    expect(zeros).toHaveLength(5)
  })
})

// ================================================================
// 2. 카드 렌더 + 카운트
// ================================================================
describe('ContentKanban — 카드 렌더', () => {
  it('각 상태의 카드 제목이 올바른 컬럼에 표시된다', () => {
    render(<ContentKanban contents={SAMPLE_CONTENTS} />)
    expect(screen.getByText('기획안 A')).toBeInTheDocument()
    expect(screen.getByText('초안 B')).toBeInTheDocument()
    expect(screen.getByText('발행됨 C')).toBeInTheDocument()
  })

  it('각 컬럼 카운트가 정확하다 (TODO:1, DRAFT:1, PUBLISHED→배포:1)', () => {
    render(<ContentKanban contents={SAMPLE_CONTENTS} />)
    // 카운트 "1" 이 3개, "0" 이 2개 (리뷰·분석)
    const ones = screen.getAllByText('1')
    expect(ones).toHaveLength(3)
  })

  it('PUBLISHED 카드는 배포 컬럼에 "발행됨" 배지를 표시한다', () => {
    render(<ContentKanban contents={SAMPLE_CONTENTS} />)
    expect(screen.getByText('발행됨')).toBeInTheDocument()
  })
})

// ================================================================
// 3. 카드 클릭 → router.push
// ================================================================
describe('ContentKanban — 카드 클릭 네비게이션', () => {
  it('카드 클릭 시 콘텐츠 상세 경로로 router.push 호출', () => {
    render(
      <ContentKanban
        contents={[makeContent({ id: 'abc123', title: '클릭 테스트', status: 'DRAFT' })]}
      />
    )
    const card = screen.getByText('클릭 테스트').closest('[class*="cursor-pointer"]') as HTMLElement
    expect(card).not.toBeNull()
    fireEvent.click(card)
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('abc123'))
  })
})

// ================================================================
// 4. 상태 전환 메뉴 (Radix DropdownMenu)
// ================================================================
describe('ContentKanban — 상태 전환 메뉴', () => {
  it('TODO 카드에 MoreHorizontal 트리거 버튼이 렌더된다', () => {
    render(
      <ContentKanban contents={[makeContent({ id: 't1', title: '메뉴 카드', status: 'TODO' })]} />
    )
    // DropdownMenuTrigger에 sr-only 텍스트가 있음
    expect(screen.getByText('상태 전환')).toBeInTheDocument()
  })

  it('ANALYZED 카드에는 상태 전환 트리거 버튼이 없다 (nextAllowed 빈 배열)', () => {
    render(
      <ContentKanban
        contents={[makeContent({ id: 'a1', title: '완료 카드', status: 'ANALYZED' })]}
      />
    )
    expect(screen.queryByText('상태 전환')).not.toBeInTheDocument()
  })

  it('TODO 카드 메뉴 클릭 시 "작성 시작" 항목이 표시된다', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <ContentKanban contents={[makeContent({ id: 't2', title: '전환 테스트', status: 'TODO' })]} />
    )

    const trigger = screen.getByRole('button', { name: '상태 전환' })
    await user.click(trigger)

    // Radix Portal로 body에 mount됨
    expect(screen.getByText('작성 시작')).toBeInTheDocument()
  })

  it('"작성 시작" 클릭 시 transition API가 호출된다', async () => {
    // jsdom 환경에서 global.fetch / Response 미정의 — 최소 mock 객체로 대체
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as unknown as Response)
    global.fetch = mockFetch
    const user = userEvent.setup({ pointerEventsCheck: 0 })

    render(
      <ContentKanban
        contents={[makeContent({ id: 'tr1', title: 'API 호출 테스트', status: 'TODO' })]}
      />
    )

    const trigger = screen.getByRole('button', { name: '상태 전환' })
    await user.click(trigger)
    await user.click(screen.getByText('작성 시작'))

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('tr1/transition'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: 'DRAFT' }),
      })
    )

    // 성공 후 router.refresh() 호출
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})
