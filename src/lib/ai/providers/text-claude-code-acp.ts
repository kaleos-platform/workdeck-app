// Claude Code ACP (Bridge) 기반 텍스트 공급자.
// DQ1: Bridge 서비스(port 18800) 에 sales-content 전용 라우트 추가 — 이 클라이언트는
// 해당 라우트가 준비되기 전에도 404/5xx 시 upstream factory가 Ollama로 fallback하도록
// 조용히 에러를 상향 전파한다.

import type { TextProvider, TextGenerateRequest, TextGenerateResult } from './index'

const GENERATE_PATH = '/sales-content/generate'
const HEALTH_PATH = '/health'

export class ClaudeCodeACPProvider implements TextProvider {
  readonly name = 'claude-code-acp'
  private readonly endpoint: string

  constructor(endpoint?: string) {
    this.endpoint = (endpoint ?? process.env.CLAUDE_CODE_ACP_ENDPOINT ?? '').replace(/\/$/, '')
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint)
  }

  // Bridge 가 살아 있는지 짧은 타임아웃으로 확인. 모든 네트워크 오류 = 비건강.
  async healthcheck(signal?: AbortSignal): Promise<boolean> {
    if (!this.isConfigured()) return false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const merged = mergeSignals(signal, controller.signal)
    try {
      const res = await fetch(`${this.endpoint}${HEALTH_PATH}`, {
        method: 'GET',
        signal: merged,
      })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }

  async generate(req: TextGenerateRequest): Promise<TextGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error('CLAUDE_CODE_ACP_ENDPOINT 가 설정되지 않았습니다')
    }
    const started = Date.now()
    const res = await fetch(`${this.endpoint}${GENERATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: req.system,
        messages: req.messages,
        responseFormat: req.responseFormat ?? 'text',
        maxTokens: req.maxTokens,
        temperature: req.temperature,
      }),
      signal: req.abortSignal,
    })
    if (!res.ok) {
      const body = await safeReadBody(res)
      throw new Error(`Claude Code ACP ${res.status}: ${body}`)
    }
    const data = (await res.json()) as {
      content?: string
      usage?: { inputTokens?: number; outputTokens?: number }
      model?: string
    }
    if (typeof data.content !== 'string') {
      throw new Error('Claude Code ACP 응답에 content 가 없습니다')
    }
    return {
      content: data.content,
      usage: data.usage,
      model: data.model,
      latencyMs: Date.now() - started,
    }
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 500)
  } catch {
    return '(body unreadable)'
  }
}

function mergeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => s != null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  const controller = new AbortController()
  for (const s of valid) {
    if (s.aborted) {
      controller.abort()
      break
    }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
