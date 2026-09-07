// OpenAI Chat Completions 기반 텍스트 공급자 (BYOK / 워크덱 제공 공용).
// SDK 미설치 — fetch 직접 호출. Spec: POST /v1/chat/completions

import type { TextProvider, TextGenerateRequest, TextGenerateResult } from './index'
import { DEFAULT_SAAS_TIMEOUT_MS, withTimeout } from './timeout'

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4.1-mini'

export class OpenAiProvider implements TextProvider {
  readonly name = 'openai'
  private readonly apiKey: string
  private readonly model: string
  private readonly endpoint: string
  private readonly timeoutMs: number

  constructor(opts?: { apiKey?: string; model?: string; endpoint?: string; timeoutMs?: number }) {
    this.apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    this.model = opts?.model || DEFAULT_MODEL
    this.endpoint = (opts?.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '')
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_SAAS_TIMEOUT_MS
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey)
  }

  async healthcheck(signal?: AbortSignal): Promise<boolean> {
    if (!this.isConfigured()) return false
    try {
      const res = await fetch(`${this.endpoint}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal,
      })
      return res.ok
    } catch {
      return false
    }
  }

  async generate(req: TextGenerateRequest): Promise<TextGenerateResult> {
    if (!this.isConfigured()) throw new Error('OpenAI API 키가 설정되지 않았습니다')
    const started = Date.now()

    const messages: { role: string; content: string }[] = []
    if (req.system) messages.push({ role: 'system', content: req.system })
    for (const m of req.messages) messages.push({ role: m.role, content: m.content })

    const res = await withTimeout(
      (signal) =>
        fetch(`${this.endpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_completion_tokens: req.maxTokens,
            temperature: req.temperature,
            response_format: req.responseFormat === 'json' ? { type: 'json_object' } : undefined,
          }),
          signal,
        }),
      this.timeoutMs,
      req.abortSignal
    )

    if (!res.ok) {
      // 응답 본문에 키가 섞이지 않도록 상태코드 + 잘라낸 본문만 노출
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`)
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      model?: string
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('OpenAI 응답에 choices[0].message.content 가 없습니다')
    }

    return {
      content,
      model: data.model ?? this.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
      latencyMs: Date.now() - started,
    }
  }
}
