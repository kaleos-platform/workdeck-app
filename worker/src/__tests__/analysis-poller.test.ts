/** @jest-environment node */
import {
  alertAnalysisProblem,
  callAnalysisAI,
  handleAnalysisFailure,
  isGeminiKeyError,
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
    if (target === 'ollama') return Response.json({ message: { content: OK_JSON } })
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
