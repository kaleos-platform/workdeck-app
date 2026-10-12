import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlackConnectCard } from '../slack-connect-card'

let mockQuery = 'spaceId=sp-kaleos'
jest.mock('next/navigation', () => ({
  usePathname: () => '/settings/integrations',
  useSearchParams: () => new URLSearchParams(mockQuery),
}))

const res = (status: number, body: unknown) => {
  const r = { status, ok: status < 300, json: async () => body, clone: () => r }
  return r
}
const fetchMock = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  mockQuery = 'spaceId=sp-kaleos'
  global.fetch = fetchMock as unknown as typeof fetch
})

it('채널 저장이 409면 서버 메시지를 보여주고, 요청에 선택한 spaceId를 붙인다', async () => {
  fetchMock
    .mockResolvedValueOnce(
      res(200, {
        installed: true,
        installation: { teamName: 'T', createdAt: '2026-10-01' },
        channels: [],
        space: { id: 'sp-kaleos', name: 'Kaleos' },
      })
    )
    .mockResolvedValueOnce(
      res(409, { message: '같은 Slack 워크스페이스의 다른 Space가 이미 쓰는 채널입니다' })
    )
  render(<SlackConnectCard slackStatus={null} />)

  expect(await screen.findByText('Space: Kaleos')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('승인 채널'), { target: { value: 'C1' } })
  fireEvent.click(screen.getAllByRole('button', { name: '등록' })[0])

  expect((await screen.findByRole('alert')).textContent).toBe(
    '같은 Slack 워크스페이스의 다른 Space가 이미 쓰는 채널입니다'
  )
  expect(fetchMock.mock.calls[0][0]).toBe('/api/slack/channels?spaceId=sp-kaleos')
  expect(fetchMock.mock.calls[1][0]).toBe('/api/slack/channels?spaceId=sp-kaleos')
})

it('선택 없이 400 SPACE_REQUIRED면 Space 선택 링크를 보여준다', async () => {
  mockQuery = 'slack=team_changed'
  fetchMock.mockResolvedValueOnce(
    res(400, {
      code: 'SPACE_REQUIRED',
      spaces: [
        { id: 'sp-aml', name: '의식주의', role: 'ADMIN' },
        { id: 'sp-kaleos', name: 'Kaleos', role: 'ADMIN' },
      ],
    })
  )
  render(<SlackConnectCard slackStatus={null} />)
  await waitFor(() =>
    expect(screen.getByText('Kaleos').closest('a')?.getAttribute('href')).toBe(
      '/settings/integrations?slack=team_changed&spaceId=sp-kaleos'
    )
  )
})
