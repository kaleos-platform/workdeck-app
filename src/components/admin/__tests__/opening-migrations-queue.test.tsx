import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { OpeningMigrationsQueue, type OpeningMigrationJobRow } from '../opening-migrations-queue'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: (...a: Parameters<typeof fetch>) => fetch(...a),
  redirectIfMfaRequired: jest.fn(),
}))

const job = (over: Partial<OpeningMigrationJobRow>): OpeningMigrationJobRow => ({
  id: 'j1',
  openingBrandId: '134',
  userEmail: 'owner@example.com',
  targetSpaceName: '크림드',
  status: 'PLANNED',
  summary: {
    brandName: '카페오닝',
    prepare: {
      postings: { included: 3, held: 1, excluded: 1 },
      templates: { included: 2 },
      stores: { active: 4 },
      positions: { active: 5 },
      images: { total: 7 },
      assets: { total: 9 },
    },
    warnings: { SOME_WARNING: 2 },
  },
  hasSnapshot: true,
  updatedAt: '2026-11-18T01:00:00.000Z',
  blockReasons: [],
  contactHits: null,
  error: null,
  createdAt: '2026-11-18T00:00:00Z',
  ...over,
})

const jobs = [
  job({ id: 'p', openingBrandId: '1', userEmail: 'planned@example.com' }),
  job({
    id: 'b',
    openingBrandId: '2',
    userEmail: 'blocked@example.com',
    status: 'BLOCKED',
    blockReasons: ['MULTI_BRAND', 'NEW_CODE'],
  }),
  job({ id: 'f', openingBrandId: '3', userEmail: 'failed@example.com', status: 'FAILED' }),
  job({ id: 'a', openingBrandId: '4', userEmail: 'approved@example.com', status: 'APPROVED' }),
  job({ id: 'd', openingBrandId: '5', userEmail: null, status: 'DONE' }),
  job({ id: 'm', openingBrandId: '7', userEmail: 'matched@example.com', status: 'MATCHED' }),
  job({ id: 'h', openingBrandId: '6', userEmail: 'held@example.com', status: 'HELD' }),
]

beforeEach(() => {
  jest.clearAllMocks()
  ;(redirectIfMfaRequired as jest.Mock).mockResolvedValue(false)
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
})

const openTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }))
const openRow = (text: string) => fireEvent.click(screen.getByText(text))

test('기본은 승인 대기 탭이고 탭 라벨에 건수가 붙는다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  expect(screen.getByRole('tab', { name: '승인 대기 1' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '차단 2' })).toBeInTheDocument()
  expect(screen.getByText('planned@example.com')).toBeInTheDocument()
  expect(screen.queryByText('blocked@example.com')).not.toBeInTheDocument()
})

test('탭을 바꾸면 해당 상태만 보이고 차단 탭에 FAILED 가 함께 있다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openTab(/^차단/)
  expect(screen.getByText('blocked@example.com')).toBeInTheDocument()
  expect(screen.getByText('failed@example.com')).toBeInTheDocument()
  expect(screen.getByText('여러 브랜드')).toBeInTheDocument()
  expect(screen.getByText('NEW_CODE')).toBeInTheDocument()
  openTab(/^완료/)
  expect(screen.getByText('—', { selector: 'td' })).toBeInTheDocument()
})

test('빈 탭은 빈 상태 문구를 보여 준다', () => {
  render(<OpeningMigrationsQueue jobs={[]} />)
  expect(screen.getByText('대조된 가입자가 없습니다')).toBeInTheDocument()
})

test('승인 버튼은 PLANNED 에서만 보이고 보류는 허용 상태에서만 보인다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openRow('planned@example.com')
  expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '보류' })).toBeInTheDocument()
})

test('차단 행에는 승인 버튼이 없고 보류만 있다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openTab(/^차단/)
  openRow('blocked@example.com')
  expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '보류' })).toBeInTheDocument()
})

test('완료 행에는 승인·보류 버튼이 없다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openTab(/^완료/)
  fireEvent.click(screen.getByText('카페오닝 #5'))
  expect(screen.queryByRole('button', { name: '보류' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
})

test('승인됨 상태는 수동 적용 대기로 표기한다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openTab(/^진행 중/)
  openRow('approved@example.com')
  expect(screen.getAllByText('승인됨 — 수동 적용 대기')).toHaveLength(2) // 표 + 상세
})

test('승인은 재확인 문구에 브랜드명·이메일을 보이고 확정해야 POST 한다', async () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openRow('planned@example.com')
  fireEvent.click(screen.getByRole('button', { name: '승인' }))
  const dialog = await screen.findByRole('dialog', { name: /승인/ })
  expect(within(dialog).getByText(/카페오닝 #1/)).toBeInTheDocument()
  expect(within(dialog).getByText(/planned@example\.com/)).toBeInTheDocument()
  expect(within(dialog).getByText(/적용은 아직 수동으로 진행됩니다/)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '승인 확정' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/admin/opening-migrations/p', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', updatedAt: '2026-11-18T01:00:00.000Z' }),
    })
  )
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

test('보류는 확인 창을 거쳐 POST 하고, 409 면 고정 문구 토스트와 refresh', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 409,
    clone: () => ({ json: async () => ({}) }),
  })
  const { toast } = jest.requireMock('sonner')
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openRow('planned@example.com')
  fireEvent.click(screen.getByRole('button', { name: '보류' }))
  fireEvent.click(await screen.findByRole('button', { name: '보류 확정' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/opening-migrations/p',
      expect.objectContaining({ body: JSON.stringify({ action: 'hold' }) })
    )
  )
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      '이미 처리되었거나 상태가 바뀌었습니다. 목록을 새로고침합니다'
    )
  )
  expect(refresh).toHaveBeenCalled()
})

test('연락처 감지 조각을 항목 제목과 함께 보이고 삭제 안내를 둔다', () => {
  render(
    <OpeningMigrationsQueue
      jobs={[
        job({
          contactHits: [
            { kind: 'posting', id: 'x', title: '홀 직원 공고', fragments: ['문의 010-12'] },
          ],
        }),
      ]}
    />
  )
  openRow('owner@example.com')
  expect(screen.getByText('홀 직원 공고')).toBeInTheDocument()
  expect(screen.getByText('문의 010-12')).toBeInTheDocument()
  expect(screen.getByText('(완료·보류 시 삭제)')).toBeInTheDocument()
})

test('DECRYPT_FAILED 면 복호화 실패 안내를 보인다', () => {
  render(<OpeningMigrationsQueue jobs={[job({ contactHits: 'DECRYPT_FAILED' })]} />)
  openRow('owner@example.com')
  expect(screen.getByText(/복호화하지 못했습니다/)).toBeInTheDocument()
})

test('MATCHED 행(진행 중 탭)은 보류만 노출한다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openTab(/^진행 중/)
  openRow('matched@example.com')
  expect(screen.getByRole('button', { name: '보류' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
})

test('보류 확인 창은 되돌릴 수 없음을 알리고 확정 전에는 POST 하지 않는다', async () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openRow('planned@example.com')
  fireEvent.click(screen.getByRole('button', { name: '보류' }))
  const dialog = await screen.findByRole('dialog', { name: /보류/ })
  expect(within(dialog).getByText(/되돌릴 수 없습니다/)).toBeInTheDocument()
  expect(within(dialog).getByText(/카페오닝 #1/)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

test('요청 중에는 확정 버튼이 비활성화된다', async () => {
  global.fetch = jest.fn().mockReturnValue(new Promise(() => {}))
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openRow('planned@example.com')
  fireEvent.click(screen.getByRole('button', { name: '승인' }))
  const confirm = await screen.findByRole('button', { name: '승인 확정' })
  fireEvent.click(confirm)
  await waitFor(() => expect(confirm).toBeDisabled())
})

test('snapshot 이 없으면 PLANNED 여도 승인 버튼이 없다', () => {
  render(<OpeningMigrationsQueue jobs={[job({ hasSnapshot: false })]} />)
  openRow('owner@example.com')
  expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '보류' })).toBeInTheDocument()
})

test('목록에 이미지·자산 건수와 연락처 감지 건수·복호화 실패 배지를 보인다', () => {
  render(
    <OpeningMigrationsQueue
      jobs={[
        job({
          id: 'c',
          contactHits: [
            { kind: 'posting', id: '1', title: 'a', fragments: ['x'] },
            { kind: 'template', id: '2', title: 'b', fragments: ['y'] },
          ],
        }),
        job({ id: 'd', userEmail: 'dec@example.com', contactHits: 'DECRYPT_FAILED' }),
        job({ id: 'n', userEmail: 'none@example.com' }),
      ]}
    />
  )
  expect(screen.getAllByText('7/9')).toHaveLength(3)
  expect(screen.getByText('연락처 조각 확인 2건')).toBeInTheDocument()
  expect(screen.getByText('연락처 복호화 실패')).toBeInTheDocument()
  // 조각이 없는 행(n)에는 확인 배지가 없다
  expect(screen.getAllByText(/^연락처 조각 확인/)).toHaveLength(1)
})

test('경고 코드는 한국어 라벨, 모르는 코드는 원문', () => {
  render(
    <OpeningMigrationsQueue
      jobs={[
        job({ summary: { brandName: 'x', warnings: { DESIGN_TOO_LARGE: 1, WEIRD_CODE: 2 } } }),
      ]}
    />
  )
  expect(screen.getByText('디자인 용량 초과 제외 1')).toBeInTheDocument()
  expect(screen.getByText('WEIRD_CODE 2')).toBeInTheDocument()
})

test('브랜드 버튼으로 키보드 접근 상세를 열 수 있다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  const button = screen.getByRole('button', { name: '카페오닝 #1 상세 열기' })
  button.focus()
  fireEvent.click(button)
  expect(screen.getByText('오프닝 이전 상세')).toBeInTheDocument()
})

test('탭이 비면 탭별 빈 문구, 전체가 비면 기본 문구', () => {
  const { unmount } = render(<OpeningMigrationsQueue jobs={[job({ status: 'DONE' })]} />)
  expect(screen.getByText('승인 대기 항목이 없습니다')).toBeInTheDocument()
  unmount()
  render(<OpeningMigrationsQueue jobs={[]} />)
  expect(screen.getByText('대조된 가입자가 없습니다')).toBeInTheDocument()
})

test('MFA 취소(403 MFA_*)면 추가 토스트를 띄우지 않는다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 403,
    clone: () => ({ json: async () => ({ code: 'MFA_CANCELLED' }) }),
  })
  const { toast } = jest.requireMock('sonner')
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openRow('planned@example.com')
  fireEvent.click(screen.getByRole('button', { name: '보류' }))
  fireEvent.click(await screen.findByRole('button', { name: '보류 확정' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByRole('button', { name: '보류 확정' })).not.toBeDisabled())
  expect(toast.error).not.toHaveBeenCalled()
})

test('APPROVED 행 상세에 완료 표시·보류 버튼이 있고 승인은 없다', () => {
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openTab(/^진행 중/)
  openRow('approved@example.com')
  expect(screen.getByRole('button', { name: '수동 적용 완료로 표시' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '보류' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
})

test('완료 표시는 확인 창에 안내·브랜드·이메일을 보이고 확정 시 complete 를 POST 한다', async () => {
  const { toast } = jest.requireMock('sonner')
  render(<OpeningMigrationsQueue jobs={jobs} />)
  openTab(/^진행 중/)
  openRow('approved@example.com')
  fireEvent.click(screen.getByRole('button', { name: '수동 적용 완료로 표시' }))
  const dialog = await screen.findByRole('dialog', { name: /완료/ })
  expect(
    within(dialog).getByText(/기존 이전 도구로 적용·보장가·완료 메일을 마쳤을 때만/)
  ).toBeInTheDocument()
  expect(within(dialog).getByText(/되돌릴 수 없습니다/)).toBeInTheDocument()
  expect(within(dialog).getByText(/카페오닝 #4/)).toBeInTheDocument()
  expect(within(dialog).getByText(/approved@example\.com/)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '완료 확정' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/admin/opening-migrations/a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete' }),
    })
  )
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('완료로 표시했습니다'))
})
