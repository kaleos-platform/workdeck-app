import { act, renderHook, waitFor } from '@testing-library/react'
import { notifyCampaignsChanged, useCampaignNavigation } from '../use-campaign-navigation'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

test('재렌더에서는 목록을 재요청하지 않고 변경 알림과 focus 때 갱신한다', async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => [{ id: 'c1', displayName: '처음' }] })
  global.fetch = fetchMock
  const { result, rerender, unmount } = renderHook(() => useCampaignNavigation(true))
  await waitFor(() => expect(result.current[0]?.displayName).toBe('처음'))
  rerender()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/campaigns?view=navigation')
  fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: 'c1', displayName: '수정' }] })
  act(() => notifyCampaignsChanged())
  await waitFor(() => expect(result.current[0]?.displayName).toBe('수정'))
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  unmount()
  act(() => notifyCampaignsChanged())
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test('다른 업무에서는 호출하지 않고 이전 요청이 최신 결과를 덮지 않는다', async () => {
  let release!: (value: unknown) => void
  const fetchMock = jest
    .fn()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    .mockResolvedValue({ ok: true, json: async () => [{ id: 'c2' }] })
  global.fetch = fetchMock
  const { result, rerender } = renderHook(({ enabled }) => useCampaignNavigation(enabled), {
    initialProps: { enabled: false },
  })
  expect(fetchMock).not.toHaveBeenCalled()
  rerender({ enabled: true })
  act(() => notifyCampaignsChanged())
  await waitFor(() => expect(result.current[0]?.id).toBe('c2'))
  await act(async () => release({ ok: true, json: async () => [{ id: 'c1' }] }))
  expect(result.current[0]?.id).toBe('c2')
})
