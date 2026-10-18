import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlackConnectCard } from '../slack-connect-card'

const res = (status: number, body: unknown) => {
  const r = { status, ok: status < 300, json: async () => body, clone: () => r }
  return r
}
const fetchMock = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
})

it('채널 저장이 409면 서버 메시지를 보여주고, 쿼리 없이 요청한다', async () => {
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
  expect(fetchMock.mock.calls[0][0]).toBe('/api/slack/channels')
  expect(fetchMock.mock.calls[1][0]).toBe('/api/slack/channels')
})

it('에이전트 채널을 나열·추가·해제하고, 추가 409면 서버 메시지를 보여준다', async () => {
  const loaded = res(200, {
    installed: true,
    installation: { teamName: 'T', createdAt: '2026-10-01' },
    channels: [
      { id: 'a1', channelId: 'CA1', channelName: null, kind: 'agent', createdAt: '2026-10-01' },
      { id: 'p1', channelId: 'CP1', channelName: null, kind: 'approvals', createdAt: '2026-10-01' },
    ],
    space: { id: 'sp-kaleos', name: 'Kaleos' },
  })
  fetchMock
    .mockResolvedValueOnce(loaded)
    .mockResolvedValueOnce(
      res(409, { message: '같은 Slack 워크스페이스의 다른 Space가 이미 쓰는 채널입니다' })
    )
    .mockResolvedValueOnce(res(200, { ok: true }))
    .mockResolvedValueOnce(loaded)
  render(<SlackConnectCard slackStatus={null} />)

  expect(await screen.findByText('CA1')).toBeTruthy()
  expect(screen.queryByText('CP1')).toBeNull()

  fireEvent.change(screen.getByLabelText('에이전트 채널'), { target: { value: 'C_TAKEN' } })
  fireEvent.click(screen.getByRole('button', { name: '추가' }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    '같은 Slack 워크스페이스의 다른 Space가 이미 쓰는 채널입니다'
  )
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    channelId: 'C_TAKEN',
    kind: 'agent',
  })
  expect(fetchMock.mock.calls[1][0]).toBe('/api/slack/channels')

  fireEvent.click(screen.getByRole('button', { name: 'CA1 해제' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  expect(fetchMock.mock.calls[2]).toEqual([
    '/api/slack/channels?kind=agent&channelId=CA1',
    { method: 'DELETE' },
  ])
})
