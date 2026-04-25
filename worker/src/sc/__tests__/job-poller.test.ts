// job-poller.ts — reportMetrics chunking 회귀.
// 웹앱 측 max(60) 제한과 일치하도록 50건씩 분할 POST 하는지 검증.

// WORKER_API_KEY 는 모듈 평가 시점에 캡처되므로 require 시점 직전에 주입.
// (ESM import 는 hoisting 되어 process.env 주입보다 먼저 실행되므로 dynamic require 사용)
let reportMetrics: typeof import('../job-poller').reportMetrics

beforeAll(() => {
  process.env.WORKER_API_KEY = 'test-key'
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- env 주입 후 cache-bypass require 필요
    reportMetrics = require('../job-poller').reportMetrics
  })
})

// fetchWithTimeout 은 global.fetch 를 그대로 호출하므로 fetch 만 mock.
const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

function makeMetrics(n: number) {
  const arr = []
  for (let i = 0; i < n; i++) {
    arr.push({ date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`, views: i })
  }
  return arr
}

function okResponse(upserted: number): Response {
  return new Response(JSON.stringify({ upserted }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('reportMetrics — chunking', () => {
  it('60건 이하는 단일 POST', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse(50))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await reportMetrics('d1', makeMetrics(50))
    expect(result).toEqual({ ok: true, count: 50 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('120건은 50/50/20 → 3 chunk POST', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(okResponse(50))
      .mockResolvedValueOnce(okResponse(50))
      .mockResolvedValueOnce(okResponse(20))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await reportMetrics('d1', makeMetrics(120))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ ok: true, count: 120 })

    // 각 호출의 chunk size 검증
    const sizes = fetchMock.mock.calls.map((args) => {
      const init = args[1] as RequestInit
      const body = JSON.parse(init.body as string) as { metrics: unknown[] }
      return body.metrics.length
    })
    expect(sizes).toEqual([50, 50, 20])
  })

  it('중간 chunk 가 실패하면 즉시 중단하고 부분 카운트 반환', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(okResponse(50))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await reportMetrics('d1', makeMetrics(120))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(false)
    expect(result.count).toBe(50)
    expect(result.errorMessage).toMatch(/chunk 2/)
  })

  it('빈 배열은 fetch 호출 없이 ok:true', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await reportMetrics('d1', [])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, count: 0 })
  })
})
