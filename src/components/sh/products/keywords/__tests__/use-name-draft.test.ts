// useNameDraft 회귀 테스트 — 두 다이얼로그(상품명·키워드)가 이 훅 하나를 공유하므로
// load() 멱등성이 깨지면 서버(Gemini) 호출이 2배가 된다. 경쟁 조건 가드도 함께 검증한다.

import { act, renderHook, waitFor } from '@testing-library/react'

import { useNameDraft } from '../use-name-draft'

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as unknown as Response
}

describe('useNameDraft', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('load()를 여러 번 불러도 fetch는 1회만 호출된다', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        names: [{ value: '상품명 후보', violations: [] }],
        keywords: [{ value: '키워드 후보', violations: [] }],
      })
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useNameDraft('p1', 'ch1'))

    // 실제 사용처(product-keyword-card.tsx)는 서로 다른 버튼의 onClick 에서 load() 를
    // 호출한다 — 각각 별개의 이벤트라 그 사이에 리렌더가 끼어든다. 그 흐름을 그대로
    // 재현하려고 act() 를 분리해서 세 번 부른다(같은 act() 안에서 동기로 세 번 부르면
    // 리렌더 없이 status 클로저가 갱신되지 않아 실제로는 재현되지 않는 상황을 테스트하게 된다).
    act(() => {
      result.current.load()
    })
    act(() => {
      result.current.load()
    })
    act(() => {
      result.current.load()
    })

    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.names).toEqual([{ value: '상품명 후보', violations: [] }])
    expect(result.current.keywords).toEqual([{ value: '키워드 후보', violations: [] }])
  })

  test('productId가 null이면 load()가 fetch를 호출하지 않는다', () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useNameDraft(null, 'ch1'))

    act(() => {
      result.current.load()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  test('성공 응답 → status success, names/keywords 채워짐', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        names: [{ value: 'A', violations: [] }],
        keywords: [{ value: 'B', violations: [] }],
      })
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useNameDraft('p1', 'ch1'))

    act(() => {
      result.current.load()
    })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.names).toEqual([{ value: 'A', violations: [] }])
    expect(result.current.keywords).toEqual([{ value: 'B', violations: [] }])
  })

  test('{ unavailable: true }(200) → status unavailable, 에러를 던지지 않는다', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ names: [], keywords: [], unavailable: true })
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useNameDraft('p1', 'ch1'))

    expect(() => {
      act(() => {
        result.current.load()
      })
    }).not.toThrow()

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  test('!res.ok(500) → status unavailable, 에러를 던지지 않는다', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({}, false))
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useNameDraft('p1', 'ch1'))

    act(() => {
      result.current.load()
    })

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  test('네트워크 실패 → status unavailable, 에러를 던지지 않는다', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('network down')
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useNameDraft('p1', 'ch1'))

    expect(() => {
      act(() => {
        result.current.load()
      })
    }).not.toThrow()

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  test('경쟁 조건: productId를 A→B로 바꾸면 A의 늦은 응답이 B의 state를 덮어쓰지 않는다', async () => {
    let resolveA: (value: Response) => void = () => {}
    const responseA = new Promise<Response>((resolve) => {
      resolveA = resolve
    })

    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/pA/')) return responseA
      return Promise.resolve(
        jsonResponse({
          names: [{ value: 'B 후보', violations: [] }],
          keywords: [{ value: 'B 키워드', violations: [] }],
        })
      )
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { result, rerender } = renderHook(({ productId }) => useNameDraft(productId, 'ch1'), {
      initialProps: { productId: 'pA' },
    })

    act(() => {
      result.current.load()
    })
    expect(result.current.status).toBe('loading')

    // productId 변경 — status는 idle로 리셋되어야 한다
    rerender({ productId: 'pB' })
    expect(result.current.status).toBe('idle')

    act(() => {
      result.current.load()
    })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.names).toEqual([{ value: 'B 후보', violations: [] }])

    // A의 응답이 이제 늦게 도착 — B의 state를 덮어쓰면 안 된다
    await act(async () => {
      resolveA(
        jsonResponse({
          names: [{ value: 'A 후보(늦음)', violations: [] }],
          keywords: [],
        })
      )
      await responseA
    })

    expect(result.current.status).toBe('success')
    expect(result.current.names).toEqual([{ value: 'B 후보', violations: [] }])
  })
})
