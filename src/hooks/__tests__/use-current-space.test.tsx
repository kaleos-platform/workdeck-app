import { act, renderHook, waitFor } from '@testing-library/react'
import { useCurrentSpaceName } from '../use-current-space'

let current: { name: string } | null
beforeEach(() => {
  current = { name: 'Space A' }
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ current }),
  })) as unknown as typeof fetch
})

it('처음 이름을 읽고, focus 시 다시 읽어 갱신한다', async () => {
  const { result } = renderHook(() => useCurrentSpaceName())
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).toBe('Space A'))
  current = { name: 'Space B' }
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(result.current).toBe('Space B'))
})

it('visibilitychange 는 보일 때만 다시 읽는다', async () => {
  const { result } = renderHook(() => useCurrentSpaceName())
  await waitFor(() => expect(result.current).toBe('Space A'))
  const calls = (global.fetch as jest.Mock).mock.calls.length
  const vis = jest.spyOn(document, 'visibilityState', 'get')
  vis.mockReturnValue('hidden')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect((global.fetch as jest.Mock).mock.calls.length).toBe(calls)
  vis.mockReturnValue('visible')
  current = { name: 'Space B' }
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await waitFor(() => expect(result.current).toBe('Space B'))
  vis.mockRestore()
})

it('언마운트 후에는 리스너를 제거하고 늦은 응답을 무시한다', async () => {
  const rm = jest.spyOn(window, 'removeEventListener')
  let resolve!: (v: unknown) => void
  global.fetch = jest.fn(() => new Promise((r) => (resolve = r))) as unknown as typeof fetch
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const { result, unmount } = renderHook(() => useCurrentSpaceName())
  unmount()
  expect(rm).toHaveBeenCalledWith('focus', expect.any(Function))
  const n = (global.fetch as jest.Mock).mock.calls.length
  window.dispatchEvent(new Event('focus'))
  expect((global.fetch as jest.Mock).mock.calls.length).toBe(n)
  await act(async () => {
    resolve({ ok: true, json: async () => ({ current: { name: 'Late' } }) })
  })
  expect(result.current).toBeNull()
  expect(err).not.toHaveBeenCalled()
  rm.mockRestore()
  err.mockRestore()
})

it('오래된 응답이 최신 응답을 덮지 않는다', async () => {
  const resolvers: Array<(v: unknown) => void> = []
  global.fetch = jest.fn(() => new Promise((r) => resolvers.push(r))) as unknown as typeof fetch
  const { result } = renderHook(() => useCurrentSpaceName())
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  const body = (name: string) => ({ ok: true, json: async () => ({ current: { name } }) })
  await act(async () => {
    resolvers[1](body('New'))
  })
  await act(async () => {
    resolvers[0](body('Old'))
  })
  expect(result.current).toBe('New')
})
