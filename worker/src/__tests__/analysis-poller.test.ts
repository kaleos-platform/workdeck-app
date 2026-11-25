/** @jest-environment node */
import {
  alertAnalysisProblem,
  callAnalysisAI,
  handleAnalysisFailure,
  isGeminiKeyError,
  fetchNegativeKeywordSummary,
  readOllamaStream,
} from '../analysis-poller.js'
import { notifyAnalysisFailed } from '../slack-notifier.js'

jest.mock('../slack-notifier.js')
const notify = notifyAnalysisFailed as jest.MockedFunction<typeof notifyAnalysisFailed>

const OK_JSON = JSON.stringify({ suggestions: [{ type: 'BID', priority: 'HIGH' }] })
let calls: string[]

/** URL 별 응답을 정해 fetch 를 흉내낸다. 호출된 대상(flash/pro/ollama/complete)을 calls 에 남긴다. */
function mockFetch(responses: Partial<Record<'flash' | 'pro' | 'ollama' | 'complete', number>>) {
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const target = url.includes('gemini-2.5-flash')
      ? 'flash'
      : url.includes('gemini-2.5-pro')
        ? 'pro'
        : url.includes('/api/chat')
          ? 'ollama'
          : 'complete'
    calls.push(target)
    const status = responses[target] ?? 200
    if (status !== 200) return new Response('{"error":"x"}', { status })
    if (target === 'ollama') {
      // 실제 Ollama 처럼 NDJSON 조각으로, 전송 경계가 줄 중간에 걸리게 보낸다.
      const half = Math.floor(OK_JSON.length / 2)
      const ndjson = [
        { message: { content: OK_JSON.slice(0, half) }, done: false },
        { message: { content: OK_JSON.slice(half) }, done: false },
        { message: { content: '' }, done: true },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
      const enc = new TextEncoder()
      const cut = Math.floor(ndjson.length / 3)
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(ndjson.slice(0, cut)))
            c.enqueue(enc.encode(ndjson.slice(cut)))
            c.close()
          },
        })
      )
    }
    if (target === 'complete') return Response.json({ status: 'FAILED' })
    return Response.json({ candidates: [{ content: { parts: [{ text: OK_JSON }] } }] })
  }) as typeof fetch
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.WORKDECK_API_URL = 'http://app.test'
  process.env.WORKER_API_KEY = 'worker-key'
  calls = []
  notify.mockReset()
  notify.mockResolvedValue(true)
})

test('isGeminiKeyError: 401·402·403·키 미설정만 키 오류', () => {
  expect(isGeminiKeyError('Gemini [402]: credits')).toBe(true)
  expect(isGeminiKeyError('gemini-2.5-flash: Gemini [403]: x / qwen3:14b: Ollama [500]: y')).toBe(
    true
  )
  expect(isGeminiKeyError('GEMINI_API_KEY 환경변수가 설정되지 않았습니다')).toBe(true)
  expect(
    isGeminiKeyError(
      'Gemini [400]: {"error":{"code":400,"message":"API key not valid. Please pass a valid API key."'
    )
  ).toBe(true)
  expect(isGeminiKeyError('Gemini [400]: {"error":{"message":"Invalid JSON payload"}}')).toBe(false)
  expect(isGeminiKeyError('Gemini [429]: quota')).toBe(false)
  expect(isGeminiKeyError('Gemini [500]: 5xx')).toBe(false)
})

test('402 → pro 건너뛰고 Ollama, 결과에 geminiError', async () => {
  mockFetch({ flash: 402 })
  const r = await callAnalysisAI('sys', 'user')
  expect(calls).toEqual(['flash', 'ollama'])
  expect(r.modelUsed).toBe('qwen3:14b')
  expect(r.geminiError).toContain('Gemini [402]')
})

test('429 → pro 로 재시도, geminiError 없음', async () => {
  mockFetch({ flash: 429 })
  const r = await callAnalysisAI('sys', 'user')
  expect(calls).toEqual(['flash', 'pro'])
  expect(r.modelUsed).toBe('gemini-2.5-pro')
  expect(r.geminiError).toBeUndefined()
})

test('flash 5xx + pro 402 → Ollama 성공이어도 geminiError', async () => {
  mockFetch({ flash: 503, pro: 402 })
  const r = await callAnalysisAI('sys', 'user')
  expect(calls).toEqual(['flash', 'pro', 'ollama'])
  expect(r.geminiError).toContain('Gemini [402]')
})

test('전부 실패 → 단계별 오류를 합쳐 throw (402 가 남는다)', async () => {
  mockFetch({ flash: 402, ollama: 500 })
  await expect(callAnalysisAI('sys', 'user')).rejects.toThrow(/Gemini \[402\].*Ollama \[500\]/)
})

test('최종 실패 → FAILED 저장 + 키 오류 알림, 같은 날 두 번째는 억제', async () => {
  mockFetch({})
  const err = new Error('gemini-2.5-flash: Gemini [402]: x / qwen3:14b: Ollama [500]: y')
  await handleAnalysisFailure('r1', 'ws-fail', err)
  expect(calls).toEqual(['complete'])
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'ws-fail', geminiKeyError: true })
  )

  await handleAnalysisFailure('r2', 'ws-fail', err)
  expect(calls).toEqual(['complete', 'complete']) // 저장은 매번
  expect(notify).toHaveBeenCalledTimes(1) // 알림은 하루 1회
})

test('실제 합친 오류(flash 503 → pro 402 → Ollama 실패)도 키 오류 알림', async () => {
  mockFetch({ flash: 503, pro: 402, ollama: 500 })
  const err = await callAnalysisAI('sys', 'user').catch((e: unknown) => e)
  await handleAnalysisFailure('r4', 'ws-mixed', err)
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'ws-mixed', geminiKeyError: true })
  )
})

test('FAILED 저장이 실패해도 알림은 보낸다', async () => {
  mockFetch({ complete: 500 })
  await handleAnalysisFailure('r3', 'ws-save-fail', new Error('Gemini [500]: down'))
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'ws-save-fail', geminiKeyError: false })
  )
})

test('알림 미발송(false)이면 억제 기록을 남기지 않아 다음에 다시 시도', async () => {
  notify.mockResolvedValueOnce(false)
  await alertAnalysisProblem({ error: 'x', workspaceId: 'ws-retry' })
  await alertAnalysisProblem({ error: 'x', workspaceId: 'ws-retry' })
  expect(notify).toHaveBeenCalledTimes(2)
})

test('Ollama 스트림 오류 줄은 throw', async () => {
  const body = new Response('{"error":"model not found"}\n').body!
  await expect(readOllamaStream(body)).rejects.toThrow('model not found')
})

describe('fetchNegativeKeywordSummary', () => {
  test('성공: 후보·캠페인·제거 후 지출 개수 집계 + workspace 헤더', async () => {
    const fn = jest.fn(async () =>
      Response.json({
        campaigns: [{ candidates: [{}, {}] }, { candidates: [] }, { candidates: [{}] }],
        spendingAfterRemoval: [{}, {}],
      })
    )
    global.fetch = fn as unknown as typeof fetch
    await expect(fetchNegativeKeywordSummary('ws1')).resolves.toEqual({
      candidateCount: 3,
      campaignCount: 2,
      spendingAfterRemovalCount: 2,
    })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://app.test/api/coupang-ads/negative-keyword-candidates')
    expect((init.headers as Record<string, string>)['x-workspace-id']).toBe('ws1')
  })

  test('404 는 undefined', async () => {
    global.fetch = jest.fn(async () => new Response('nf', { status: 404 })) as typeof fetch
    await expect(fetchNegativeKeywordSummary('ws1')).resolves.toBeUndefined()
  })

  test('타임아웃(abort)은 undefined', async () => {
    global.fetch = jest.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError')
    }) as typeof fetch
    await expect(fetchNegativeKeywordSummary('ws1')).resolves.toBeUndefined()
  })

  test('workspaceId 없으면 호출 안 함', async () => {
    const fn = jest.fn()
    global.fetch = fn as unknown as typeof fetch
    await expect(fetchNegativeKeywordSummary(undefined)).resolves.toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })
})
