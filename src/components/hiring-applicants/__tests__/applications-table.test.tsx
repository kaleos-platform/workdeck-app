import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { ApplicationsTable } from '../applications-table'

const refresh = jest.fn()
const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))
jest.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode
    value: string
    onValueChange: (v: string) => void
    disabled?: boolean
  }) => (
    <select value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}))
const props = {
  rows: ['a', 'b'].map((id) => ({
    id,
    maskedName: `QA${id}`,
    postingTitle: 'QA',
    stage: 'HIRING' as const,
    hiringStage: 'APPLIED' as const,
    duplicated: false,
    blacklisted: false,
    createdAt: '2026-09-27',
  })),
  total: 2,
  pageSize: 50,
  page: 1,
  postings: [],
  filters: { posting: '', stage: '', from: '2026-09-27', to: '' },
}
beforeEach(() => jest.clearAllMocks())

it('일괄 변경 중 선택과 필터를 잠그고 실제 변경 건수를 안내한다', async () => {
  let finish!: (v: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(<ApplicationsTable {...props} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '전체 선택' }))
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'ACCEPTED' } })
  fireEvent.click(screen.getByRole('button', { name: '적용' }))
  expect(screen.getByRole('checkbox', { name: 'QAa 선택' })).toBeDisabled()
  expect(screen.getAllByRole('combobox')[0]).toBeDisabled()
  await act(async () => finish({ ok: true, json: async () => ({ updated: 1 }) }))
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('2건 중 1건'))
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('일괄 변경 실패 후 선택을 유지하고 재시도한다', async () => {
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error('연결 실패'))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ updated: 2 }) })
  render(<ApplicationsTable {...props} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '전체 선택' }))
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'ACCEPTED' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '적용' })))
  expect(screen.getByRole('checkbox', { name: 'QAa 선택' })).toBeChecked()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '적용' })))
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('2건'))
})

it('엑셀 실패는 목록에서 오류를 안내하고 버튼을 다시 활성화한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: false, json: async () => ({ message: '기간을 나눠 주세요' }) })
  render(<ApplicationsTable {...props} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '엑셀 내보내기' })))
  expect(toast.error).toHaveBeenCalledWith('기간을 나눠 주세요')
  expect(screen.getByRole('button', { name: '엑셀 내보내기' })).toBeEnabled()
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('from=2026-09-27'))
})

it('엑셀을 기다리는 동안 중복 요청을 막고 성공한 파일만 다운로드한다', async () => {
  let finish!: (v: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  URL.createObjectURL = jest.fn(() => 'blob:qa')
  URL.revokeObjectURL = jest.fn()
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<ApplicationsTable {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '엑셀 내보내기' }))
  expect(screen.getByRole('button', { name: '엑셀 내보내기' })).toBeDisabled()
  await act(async () =>
    finish({
      ok: true,
      headers: new Headers({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      blob: async () => new Blob(['qa']),
    })
  )
  expect(click).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '엑셀 내보내기' })).toBeEnabled()
  click.mockRestore()
})

it('로그인 HTML 응답을 엑셀 파일로 저장하지 않는다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, headers: new Headers({ 'Content-Type': 'text/html' }) })
  URL.createObjectURL = jest.fn()
  render(<ApplicationsTable {...props} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '엑셀 내보내기' })))
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('로그인 상태'))
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('범위 밖 페이지는 날짜 필터를 유지한 채 첫 페이지로 복구한다', () => {
  render(<ApplicationsTable {...props} rows={[]} page={999} />)
  fireEvent.click(screen.getByRole('button', { name: '첫 페이지로 이동' }))
  expect(push).toHaveBeenCalledWith('/d/recruiting/applications?from=2026-09-27')
})
