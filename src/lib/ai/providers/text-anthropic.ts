// Anthropic Messages API 기반 텍스트 공급자 (BYOK / 워크덱 제공 공용).
// @anthropic-ai/sdk 는 이미 설치돼 있다 (src/lib/agent/llm/agent-loop.ts 사용).

import Anthropic from '@anthropic-ai/sdk'
import type { TextProvider, TextGenerateRequest, TextGenerateResult } from './index'
import { DEFAULT_SAAS_TIMEOUT_MS } from './timeout'

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const DEFAULT_MAX_TOKENS = 4096

export class AnthropicProvider implements TextProvider {
  readonly name = 'anthropic'
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(opts?: { apiKey?: string; model?: string; timeoutMs?: number }) {
    this.apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
    this.model = opts?.model || DEFAULT_MODEL
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_SAAS_TIMEOUT_MS
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey)
  }

  async healthcheck(): Promise<boolean> {
    if (!this.isConfigured()) return false
    try {
      await this.client().models.list()
      return true
    } catch {
      return false
    }
  }

  private client(): Anthropic {
    return new Anthropic({ apiKey: this.apiKey, timeout: this.timeoutMs })
  }

  async generate(req: TextGenerateRequest): Promise<TextGenerateResult> {
    if (!this.isConfigured()) throw new Error('Anthropic API 키가 설정되지 않았습니다')
    const started = Date.now()

    // Anthropic 은 system 이 별도 파라미터이고 messages 에 system role 을 허용하지 않는다.
    const system = [req.system, ...req.messages.filter((m) => m.role === 'system').map((m) => m.content)]
      .filter(Boolean)
      .join('\n\n')
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    if (messages.length === 0) throw new Error('Anthropic 요청에 user 메시지가 필요합니다')

    const response = await this.client().messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: req.temperature,
        system: system || undefined,
        messages,
      },
      { signal: req.abortSignal }
    )

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!content) throw new Error('Anthropic 응답에 텍스트 블록이 없습니다')

    return {
      content,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      latencyMs: Date.now() - started,
    }
  }
}
