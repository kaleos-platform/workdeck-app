import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadForm } from '../lead-form'
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }))
const originalFetch = global.fetch
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ signupUrl: 'https://app.test/signup?lead=id.signed' }),
  } as Response)
})
afterEach(() => {
  global.fetch = originalFetch
})
it('접수 성공 후 API가 돌려준 서명 링크로 바로 가입할 수 있다', async () => {
  const user = userEvent.setup()
  render(<LeadForm deck="recruiting" />)
  for (const [label, value] of [
    ['이름', '테스트'],
    ['휴대폰 번호', '01012345678'],
    ['이메일', 'test@example.com'],
    ['회사명', '테스트회사'],
    ['직책', '대표'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: '5~9명' }))
  await user.click(screen.getByRole('checkbox'))
  fireEvent.submit(screen.getByLabelText('이름').closest('form')!)
  await waitFor(() =>
    expect(screen.getByRole('link', { name: '바로 가입하기' })).toHaveAttribute(
      'href',
      'https://app.test/signup?lead=id.signed'
    )
  )
  expect(screen.getByText('신청한 이메일로 가입해 주세요.')).toBeInTheDocument()
})
