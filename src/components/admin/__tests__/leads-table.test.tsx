import { fireEvent, render, screen, within } from '@testing-library/react'
import { LeadsTable, type Lead } from '../leads-table'
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
const lead: Lead = {
  id: 'lead-1',
  deck: 'recruiting',
  name: '담당자',
  phone: '01012345678',
  email: 'lead@example.com',
  companyName: '테스트회사',
  position: '대표',
  employeeCount: '5-9',
  status: 'NEW',
  memo: '',
  createdAt: '2026-01-01T00:00:00Z',
  source: { landing: 'lead', utm_source: 'google' },
  applicationCount: 2,
  joinedAt: '2026-02-01T00:00:00Z',
  invitedAt: null,
  signupUrl: 'https://app.test/signup?lead=id.signed',
}
const table = (row = lead) => (
  <LeadsTable leads={[row]} status="" statuses={['NEW', 'CONTACTED', 'CONVERTED', 'DROPPED']} />
)
it('출처·중복 문의·가입 정보를 표시하고 종료 신청 발송은 막는다', () => {
  const { rerender } = render(table())
  expect(screen.getByText('도입 문의 · google')).toBeInTheDocument()
  expect(screen.getByText('같은 이메일 신청 2회')).toBeInTheDocument()
  expect(screen.getByText('가입함')).toBeInTheDocument()
  rerender(table({ ...lead, status: 'DROPPED', applicationCount: 1 }))
  expect(screen.getByRole('button', { name: '안내 메일 보내기' })).toBeDisabled()
  expect(screen.queryByText('같은 이메일 신청 1회')).not.toBeInTheDocument()
})
it('메일 발송 뒤 refresh가 바꾼 상태를 즉시 표시한다', () => {
  const { rerender } = render(table())
  expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('신규')
  rerender(table({ ...lead, status: 'CONTACTED' }))
  expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('연락함')
})
it('발송 다이얼로그는 실제 본문 미리보기에서 메시지를 이스케이프한다', () => {
  render(table())
  fireEvent.click(screen.getByRole('button', { name: '안내 메일 보내기' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('운영자 메시지 (선택)'), {
    target: { value: '<b>안내</b> https://evil.example' },
  })
  const preview = within(dialog).getByTitle('안내 메일 미리보기')
  expect(preview.getAttribute('srcdoc')).toContain('&lt;b&gt;안내&lt;/b&gt; https://evil.example')
  expect(preview.getAttribute('srcdoc')).not.toContain('href="https://evil.example')
  expect(preview).toHaveAttribute('sandbox', '')
})

it('이미 발송한 응답은 새 발송으로 안내하지 않는다', async () => {
  const { toast } = await import('sonner')
  const success = jest.spyOn(toast, 'success')
  const previousFetch = global.fetch
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true, alreadySent: true }) })
  try {
    render(table())
    fireEvent.click(screen.getByRole('button', { name: '안내 메일 보내기' }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '안내 메일 보내기' })
    )
    const { waitFor } = await import('@testing-library/react')
    await waitFor(() => expect(success).toHaveBeenCalledWith('오늘 이미 안내 메일을 보냈습니다'))
  } finally {
    global.fetch = previousFetch
    success.mockRestore()
  }
})
