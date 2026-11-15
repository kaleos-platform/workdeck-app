import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactDialog } from '../contact-dialog'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

beforeEach(() => {
  global.fetch = jest.fn(async (url: string) =>
    String(url).includes('message-templates')
      ? { ok: true, json: async () => ({ items: [] }) }
      : { ok: true, json: async () => ({ statusUrl: '/p/status/abc' }) }
  ) as unknown as typeof fetch
})

const base = {
  applicationId: 'app-1',
  phone: '010-1234-5678' as string | null,
  name: '홍길동',
  postingTitle: '공고',
  positionName: '서빙',
  notifications: [
    { id: 'n1', notiType: 'INTERVIEW' as const, createdAt: '2026-11-10T00:00:00.000Z' },
  ],
  open: true,
  onOpenChange: jest.fn(),
}

it('문자·전화·상태 안내 링크 3개 탭을 보여주고 문자가 기본이다', async () => {
  await act(async () => {
    render(<ContactDialog {...base} />)
  })
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
    '문자',
    '전화',
    '상태 안내 링크',
  ])
  expect(screen.getByLabelText('문자 내용')).toBeInTheDocument()
})

it('전화 탭은 tel 링크와 번호 복사를 보여준다', async () => {
  await act(async () => {
    render(<ContactDialog {...base} />)
  })
  await userEvent.click(screen.getByRole('tab', { name: '전화' }))
  expect(screen.getByRole('link', { name: /전화 걸기/ })).toHaveAttribute('href', 'tel:01012345678')
  expect(screen.getByRole('button', { name: /번호 복사/ })).toBeInTheDocument()
})

it('연락처가 없으면 문자·전화가 비활성이고 안내를 보여준다', async () => {
  await act(async () => {
    render(<ContactDialog {...base} phone={null} />)
  })
  expect(screen.getByRole('tab', { name: '문자' })).toBeDisabled()
  expect(screen.getByRole('tab', { name: '전화' })).toBeDisabled()
  expect(screen.getByText(/연락처가 없어/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /링크 생성/ })).toBeInTheDocument()
})

it('상태 안내 링크 탭에서 링크를 만들고 발송 이력을 보여준다', async () => {
  await act(async () => {
    render(<ContactDialog {...base} />)
  })
  await userEvent.click(screen.getByRole('tab', { name: '상태 안내 링크' }))
  const history = screen.getByText('알림 발송 이력').parentElement!
  expect(within(history).getByText('면접 안내')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /링크 생성/ }))
  expect(
    await screen.findByDisplayValue(`${window.location.origin}/p/status/abc`)
  ).toBeInTheDocument()
  expect(refresh).toHaveBeenCalled()
})
