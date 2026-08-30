// useNameDraft 회귀 테스트.
//
// 이 훅에는 **AI 비용이 걸려 있다.** 서버는 한 번의 Gemini 호출로 상품명·키워드를 함께 만들고
// (src/lib/sh/keyword-ai-draft.ts), 상품명/키워드 두 다이얼로그가 이 훅 하나를 공유해서 호출을
// 1회로 고정한다. load() 의 `status !== 'idle'` 가드를 누가 지우면 화면은 멀쩡해 보이는데
// 호출만 2배가 된다 — 그 회귀를 여기서 잡는다.

import { act, renderHook, waitFor } from '@testing-library/react'

import { useNameDraft } from '../use-name-draft'

function okResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response
}

function setupFetch(impl: () => Promise<Response>) {
  const mock = jest.fn(impl)
  global.fetch = mock as unknown as typeof fetch
  return mock
}

const SUCCESS = {
  names: [{ value: '상품명 후보', violations: [] }],
  keywords: [
    { value: '키워드후보', violations: [], intent: 'PURPOSE', intentLabel: '용도', reason: '사유' },
  ],
  reviews: [
    {
      keyword: '등록어',
      label: 'LOW_INTENT',
      labelText: '구매의도 낮음',
      reason: '정보 탐색성',
      violations: [],
      recommendRemove: true,
    },
  ],
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('useNameDraft', () => {
  it('load() 를 여러 번 불러도 fetch 는 1회만 나간다 (두 다이얼로그가 훅을 공유한다)', async () => {
    const fetchMock = setupFetch(async () => okResponse(SUCCESS))
    const { result } = renderHook(() => useNameDraft('p1', 'c1'))

    act(() => {
      result.current.load()
      result.current.load()
    })
    await waitFor(() => expect(result.current.status).toBe('success'))
    act(() => result.current.load())

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('productId 가 null 이면 fetch 를 아예 부르지 않는다', () => {
    const fetchMock = setupFetch(async () => okResponse(SUCCESS))
    const { result } = renderHook(() => useNameDraft(null, 'c1'))

    act(() => result.current.load())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('성공하면 names·keywords 를 채운다', async () => {
    setupFetch(async () => okResponse(SUCCESS))
    const { result } = renderHook(() => useNameDraft('p1', 'c1'))

    act(() => result.current.load())

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.names).toHaveLength(1)
    expect(result.current.keywords).toHaveLength(1)
  })

  it('unavailable:true 는 200 이지만 에러가 아니다 — 조용히 unavailable', async () => {
    setupFetch(async () => okResponse({ names: [], keywords: [], unavailable: true }))
    const { result } = renderHook(() => useNameDraft('p1', 'c1'))

    act(() => result.current.load())

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  it('!res.ok 도 unavailable 로 흡수한다 (throw 하지 않는다)', async () => {
    setupFetch(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response)
    const { result } = renderHook(() => useNameDraft('p1', 'c1'))

    act(() => result.current.load())

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  it('네트워크 실패도 unavailable 로 흡수한다', async () => {
    setupFetch(async () => {
      throw new Error('network down')
    })
    const { result } = renderHook(() => useNameDraft('p1', 'c1'))

    act(() => result.current.load())

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  it('productId 가 바뀌면 status 가 idle 로 리셋되고 다음 load() 가 새로 받아온다', async () => {
    const fetchMock = setupFetch(async () => okResponse(SUCCESS))
    const { result, rerender } = renderHook(({ pid }: { pid: string }) => useNameDraft(pid, 'c1'), {
      initialProps: { pid: 'p1' },
    })

    act(() => result.current.load())
    await waitFor(() => expect(result.current.status).toBe('success'))

    rerender({ pid: 'p2' })
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.names).toHaveLength(0)

    act(() => result.current.load())
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('상품을 바꾸면 이전 상품의 늦은 응답이 새 상품 상태를 덮어쓰지 않는다', async () => {
    // p1 요청만 붙잡아 뒀다가 p2 로 전환된 뒤에 응답시킨다.
    let releaseFirst: (() => void) | null = null
    const fetchMock = setupFetch(async () => {
      if (fetchMock.mock.calls.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        return okResponse({ names: [{ value: 'p1 후보', violations: [] }], keywords: [] })
      }
      return okResponse(SUCCESS)
    })

    const { result, rerender } = renderHook(({ pid }: { pid: string }) => useNameDraft(pid, 'c1'), {
      initialProps: { pid: 'p1' },
    })

    act(() => result.current.load())
    await waitFor(() => expect(result.current.status).toBe('loading'))

    rerender({ pid: 'p2' })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    // 여기서 p1 응답이 뒤늦게 도착한다.
    await act(async () => {
      releaseFirst?.()
      await Promise.resolve()
    })

    // p1 의 결과가 새어 들어오면 안 된다.
    expect(result.current.names).toHaveLength(0)
    expect(result.current.status).toBe('idle')
  })
})

describe('useNameDraft — 등록 검색어 진단', () => {
  it('응답의 reviews 를 그대로 노출한다', async () => {
    setupFetch(async () => okResponse(SUCCESS))

    const { result } = renderHook(() => useNameDraft('p1', 'c1'))
    act(() => result.current.load())
    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(result.current.reviews).toHaveLength(1)
    expect(result.current.reviews[0].recommendRemove).toBe(true)
  })

  it('reviews 가 없는 구버전 응답에도 빈 배열로 안전하다', async () => {
    setupFetch(async () => okResponse({ names: SUCCESS.names, keywords: SUCCESS.keywords }))

    const { result } = renderHook(() => useNameDraft('p1', 'c1'))
    act(() => result.current.load())
    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(result.current.reviews).toEqual([])
  })

  it('unavailable 이면 reviews 도 비어 있다', async () => {
    setupFetch(async () => okResponse({ names: [], keywords: [], reviews: [], unavailable: true }))

    const { result } = renderHook(() => useNameDraft('p1', 'c1'))
    act(() => result.current.load())
    await waitFor(() => expect(result.current.status).toBe('unavailable'))

    expect(result.current.reviews).toEqual([])
  })
})
