import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ErrorsTable, type ErrorRow, type Summary } from '../errors-table'

const mockPush = jest.fn()
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}))
const mockFetch = jest.fn()
jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: (...a: unknown[]) => mockFetch(...a),
  redirectIfMfaRequired: async () => false,
}))

const row = (over: Partial<ErrorRow>): ErrorRow => ({
  id: 'i',
  shortId: 'APP-1',
  title: 'Error',
  culprit: '',
  permalink: 'https://sentry.invalid/1',
  count: 1,
  userCount: 0,
  firstSeen: '2026-11-19T00:00:00Z',
  lastSeen: '2026-11-20T00:00:00Z',
  service: 'web',
  autofix: { kind: 'none' },
  triage: null,
  stage: 'unjudged',
  ...over,
})
const rows = [
  row({
    id: 'a',
    shortId: 'APP-A',
    title: '나 오류',
    count: 5,
    userCount: 2,
    lastSeen: '2026-11-21T00:00:00Z',
  }),
  row({
    id: 'b',
    shortId: 'APP-B',
    title: '가 오류',
    count: 50,
    userCount: 1,
    lastSeen: '2026-11-23T00:00:00Z',
    service: 'worker',
  }),
  row({
    id: 'c',
    shortId: 'APP-C',
    title: '다 오류',
    count: 9,
    userCount: 3,
    lastSeen: '2026-11-22T00:00:00Z',
  }),
]
const summary: Summary = { total: 3, approval: 1, confirm: 2, ignore: 0, p1: 1 }
const props = {
  service: 'all' as const,
  stage: 'all' as const,
  summary,
  counts: { web: 2, worker: 1 },
  lastActivity: null,
}
const order = () => screen.getAllByRole('link', { name: /오류$/ }).map((a) => a.textContent)
const head = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

it('기본은 받은 순서(사용자 많은 순)를 유지하고 컬럼을 눌러 정렬한다', () => {
  render(<ErrorsTable rows={rows} {...props} />)
  expect(order()).toEqual(['나 오류', '가 오류', '다 오류'])

  fireEvent.click(head('발생'))
  expect(order()).toEqual(['가 오류', '다 오류', '나 오류'])
  expect(screen.getByRole('columnheader', { name: /발생/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  )
  fireEvent.click(head('발생'))
  expect(order()).toEqual(['나 오류', '다 오류', '가 오류'])

  fireEvent.click(head('사용자'))
  expect(order()).toEqual(['다 오류', '나 오류', '가 오류'])

  fireEvent.click(head('마지막'))
  expect(order()).toEqual(['가 오류', '다 오류', '나 오류'])

  fireEvent.click(head('오류'))
  expect(order()).toEqual(['가 오류', '나 오류', '다 오류'])
})

const ID = '20261125-070000-ab12-APP-1'
const SHA = '0123456789abcdef'
const approvalRow = row({
  id: 'r1',
  title: '승인 오류',
  count: 48,
  userCount: 3,
  firstSeen: new Date(Date.now() - 2.5 * 86_400_000).toISOString(),
  triage: { p: 'P1', cat: 'data-loss', act: 'fix', at: '2026-11-25T00:00:00Z' },
  autofix: {
    kind: 'ready',
    at: '2026-11-25T01:00:00Z',
    id: ID,
    sha: SHA,
    files: 2,
    lines: 14,
    verify: 'ok',
    review: 'approve',
  },
  stage: 'approval',
})

beforeEach(() => {
  mockPush.mockClear()
  mockFetch.mockReset()
})

it('요약 칩 개수를 보이고 누르면 URL 을 바꾼다', () => {
  render(<ErrorsTable rows={rows} {...props} />)
  expect(screen.getByRole('button', { name: '전체 3' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '확인 필요 2' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '승인 대기 1' }))
  expect(mockPush).toHaveBeenLastCalledWith('/admin/errors?stage=approval')
  fireEvent.click(screen.getByRole('button', { name: 'P1 1' }))
  expect(mockPush).toHaveBeenLastCalledWith('/admin/errors?priority=P1')
})

it('우선순위 배지와 근거 문장, 우선순위 정렬', () => {
  const p3 = row({
    id: 'p3',
    title: '낮은 오류',
    triage: { p: 'P3', cat: 'noise', act: 'ignore', at: '2026-11-25T00:00:00Z' },
    stage: 'ignore-suggested',
  })
  render(<ErrorsTable rows={[p3, approvalRow, row({ id: 'n', title: '없는 오류' })]} {...props} />)
  expect(screen.getByText('P1 높음')).toBeInTheDocument()
  expect(screen.getByText('P3 낮음')).toBeInTheDocument()
  expect(screen.getByText('판단 전')).toBeInTheDocument()
  expect(screen.getByText(/^데이터 누락 · 3일간 48회 · 사용자 3명$/)).toBeInTheDocument()
  fireEvent.click(head('우선순위'))
  expect(order()).toEqual(['승인 오류', '낮은 오류', '없는 오류'])
})

it('검증 실패 ready 행은 검증 실패 배지만 있고 PR 올리기 버튼이 없다', () => {
  const bad = { ...approvalRow, autofix: { ...approvalRow.autofix, verify: 'fail' as const } }
  render(<ErrorsTable rows={[bad]} {...props} />)
  expect(screen.getAllByText('검증 실패').length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: 'PR 올리기' })).toBeNull()
})

it('승인 대기 행은 PR 올리기로 id·sha 를 보낸다', async () => {
  mockFetch.mockResolvedValue({ ok: true, status: 200 })
  render(<ErrorsTable rows={[approvalRow]} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'PR 올리기' }))
  await waitFor(() => expect(mockFetch).toHaveBeenCalled())
  expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/errors/r1')
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
    action: 'approve',
    id: ID,
    sha: SHA,
  })
})

it('행을 누르면 AI 판단·수정안 시트가 열린다', () => {
  render(<ErrorsTable rows={[approvalRow]} {...props} />)
  fireEvent.click(screen.getByText('P1 높음'))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('AI 판단')).toBeInTheDocument()
  expect(screen.getByText('수정안')).toBeInTheDocument()
  expect(screen.getByText('2개 파일 · 14줄')).toBeInTheDocument()
  expect(screen.getByText('코드는 PR에서 검토합니다')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Sentry에서 보기 ↗' })).toHaveAttribute(
    'target',
    '_blank'
  )
})

it('판단 전 행의 시트는 수정안 없이 안내만 보인다', () => {
  render(<ErrorsTable rows={[row({ id: 'n', title: '없는 오류' })]} {...props} />)
  fireEvent.click(screen.getByText('판단 전'))
  expect(screen.getByText('아직 판단 전')).toBeInTheDocument()
  expect(screen.queryByText('수정안')).not.toBeInTheDocument()
})

describe('분석 요청 단계별 버튼', () => {
  const names = () => screen.queryAllByRole('button').map((b) => b.textContent)
  const rowButtons = () =>
    names().filter((n) =>
      ['분석 요청', '수정 요청', '제외', '제외 확정', '다시 요청'].includes(n ?? '')
    )
  const an = (autofix: ErrorRow['autofix'], stage: ErrorRow['stage']) =>
    row({ id: 'z', title: '분석 오류', autofix, stage })

  it('확인 필요 행: [분석 요청][제외], 시트에는 [수정 요청] 추가', () => {
    render(<ErrorsTable rows={[an({ kind: 'none' }, 'confirm')]} {...props} />)
    expect(rowButtons()).toEqual(['분석 요청', '제외'])
    fireEvent.click(screen.getByText('판단 전'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(rowButtons()).toEqual(['분석 요청', '수정 요청', '제외'])
  })

  it('분석 요청 → analyze 액션과 토스트 대상 호출', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 })
    render(<ErrorsTable rows={[an({ kind: 'none' }, 'confirm')]} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '분석 요청' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ action: 'analyze' })
  })

  it('분석 요청됨 [제외] / 분석 중 버튼 없음 / 만료 [다시 요청] / 실패 [다시 요청][제외]', () => {
    const { rerender } = render(
      <ErrorsTable rows={[an({ kind: 'analyze-request' }, 'analyze-requested')]} {...props} />
    )
    expect(rowButtons()).toEqual(['제외'])
    rerender(
      <ErrorsTable
        rows={[an({ kind: 'analyzing', until: '2999-01-01T00:00:00Z' }, 'analyzing')]}
        {...props}
      />
    )
    expect(rowButtons()).toEqual([])
    rerender(
      <ErrorsTable
        rows={[an({ kind: 'analyzing', until: '2000-01-01T00:00:00Z' }, 'analyzing')]}
        {...props}
      />
    )
    expect(screen.getByText('분석 중(만료)')).toBeInTheDocument()
    expect(rowButtons()).toEqual(['다시 요청'])
    rerender(<ErrorsTable rows={[an({ kind: 'analyze-failed' }, 'analyze-failed')]} {...props} />)
    expect(rowButtons()).toEqual(['다시 요청', '제외'])
  })

  it('분석 완료: 판정별 버튼과 이슈 링크 배지', () => {
    const done = (verdict: 'fix' | 'watch' | 'ignore') =>
      an(
        {
          kind: 'analyzed',
          verdict,
          conf: 'mid',
          auto: 'yes',
          issueNumber: 42,
          at: '2026-11-27T00:00:00Z',
        },
        'analyzed'
      )
    const { rerender } = render(<ErrorsTable rows={[done('fix')]} {...props} />)
    expect(rowButtons()).toEqual(['수정 요청', '제외'])
    const link = screen.getByRole('link', { name: '고칠 것 · 이슈 #42 ↗' })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/kaleos-platform/kaleos-ax-project/issues/42'
    )
    rerender(<ErrorsTable rows={[done('watch')]} {...props} />)
    expect(rowButtons()).toEqual(['제외'])
    expect(screen.getByRole('link', { name: '지켜볼 것 · 이슈 #42 ↗' })).toBeInTheDocument()
    rerender(<ErrorsTable rows={[done('ignore')]} {...props} />)
    expect(rowButtons()).toEqual(['제외 확정'])
    expect(screen.getByRole('link', { name: '무시 · 이슈 #42 ↗' })).toBeInTheDocument()
  })

  it('시트 「분석」 섹션: 판정·확신도·자동 수정·결과 링크', () => {
    render(
      <ErrorsTable
        rows={[
          an(
            {
              kind: 'analyzed',
              verdict: 'fix',
              conf: 'high',
              auto: 'no',
              issueNumber: 7,
              at: '2026-11-27T00:00:00Z',
            },
            'analyzed'
          ),
        ]}
        {...props}
      />
    )
    fireEvent.click(screen.getByText('판단 전'))
    expect(screen.getByText('분석')).toBeInTheDocument()
    expect(screen.getByText('높음')).toBeInTheDocument()
    expect(screen.getByText('불가')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '이슈 #7 ↗' })).toBeInTheDocument()
  })
})
