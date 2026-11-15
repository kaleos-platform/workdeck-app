import { act, fireEvent, render, screen } from '@testing-library/react'
import { NotificationSender } from '../notification-sender'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ statusUrl: '/p/status/abc' }),
  })) as unknown as typeof fetch
})

it('메시지 템플릿을 불러오지 않고 결과 확인 링크만 생성한다', async () => {
  render(<NotificationSender applicationId="app-1" />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /상태 알림/ })))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /링크 생성/ })))

  const calls = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url))
  expect(calls).toEqual(['/api/hiring-applicants/applications/app-1/notifications'])
  expect(calls.some((url) => url.includes('message-templates'))).toBe(false)
  expect(
    await screen.findByDisplayValue(`${window.location.origin}/p/status/abc`)
  ).toBeInTheDocument()
})
