import { ClaudeCodeACPProvider } from '../text-claude-code-acp'

describe('ClaudeCodeACPProvider', () => {
  const ENDPOINT = 'http://127.0.0.1:18800'
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('endpoint 가 없으면 isConfigured=false', () => {
    const p = new ClaudeCodeACPProvider('')
    expect(p.isConfigured()).toBe(false)
  })

  it('healthcheck: 200 응답이면 true', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response) as unknown as typeof fetch
    const p = new ClaudeCodeACPProvider(ENDPOINT)
    expect(await p.healthcheck()).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      `${ENDPOINT}/health`,
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('healthcheck: 네트워크 에러면 false', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    const p = new ClaudeCodeACPProvider(ENDPOINT)
    expect(await p.healthcheck()).toBe(false)
  })

  it('healthcheck: 5xx 면 false', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 } as Response) as unknown as typeof fetch
    const p = new ClaudeCodeACPProvider(ENDPOINT)
    expect(await p.healthcheck()).toBe(false)
  })

  it('generate: 성공 응답을 파싱한다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: 'hello world',
        usage: { inputTokens: 10, outputTokens: 5 },
        model: 'claude-opus-4-7',
      }),
    } as Response) as unknown as typeof fetch

    const p = new ClaudeCodeACPProvider(ENDPOINT)
    const result = await p.generate({
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.content).toBe('hello world')
    expect(result.usage?.inputTokens).toBe(10)
    expect(result.model).toBe('claude-opus-4-7')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('generate: 5xx 는 Error 로 상향된다 (factory fallback 용)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'upstream bridge not ready',
    } as Response) as unknown as typeof fetch

    const p = new ClaudeCodeACPProvider(ENDPOINT)
    await expect(p.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/502/)
  })

  it('generate: content 가 누락되면 명확한 에러', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usage: {} }),
    } as Response) as unknown as typeof fetch

    const p = new ClaudeCodeACPProvider(ENDPOINT)
    await expect(p.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      /content/
    )
  })
})
