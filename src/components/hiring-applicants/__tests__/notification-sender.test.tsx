import { act, fireEvent, render, screen } from '@testing-library/react'
import { NotificationSender } from '../notification-sender'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

beforeEach(() => {
  global.fetch = jest.fn(async (url: string) =>
    String(url).includes('message-templates')
      ? {
          ok: true,
          json: async () => ({ items: [{ id: 't1', title: '합격', content: '{이름}님 {직무}' }] }),
        }
      : { ok: true, json: async () => ({ statusUrl: '/p/status/abc' }) }
  ) as unknown as typeof fetch
})

it('자주 쓰는 메시지 칩이 지원자 정보로 치환되어 채워진다', async () => {
  render(<NotificationSender applicationId="app-1" name="홍길동" positionName="서빙" />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /상태 알림/ })))
  await act(async () => fireEvent.click(await screen.findByRole('button', { name: '합격' })))
  expect(screen.getByDisplayValue('홍길동님 서빙')).toBeInTheDocument()
})

it('결과 확인 링크를 생성한다', async () => {
  render(<NotificationSender applicationId="app-1" />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /상태 알림/ })))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /링크 생성/ })))
  expect(
    await screen.findByDisplayValue(`${window.location.origin}/p/status/abc`)
  ).toBeInTheDocument()
})
