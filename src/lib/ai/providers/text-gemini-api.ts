// Gemini API 기반 텍스트 공급자 (BYOK / 워크덱 제공 공용).
// CLI 를 exec 하는 text-gemini.ts 와 별개 — 이쪽은 HTTP SDK(@google/genai).

import { GoogleGenAI } from '@google/genai'
import type { TextProvider, TextGenerateRequest, TextGenerateResult } from './index'
import { DEFAULT_SAAS_TIMEOUT_MS, withTimeout } from './timeout'

const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiApiProvider implements TextProvider {
  readonly name = 'gemini-api'
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(opts?: { apiKey?: string; model?: string; timeoutMs?: number }) {
    this.apiKey = opts?.apiKey ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? ''
    this.model = opts?.model || DEFAULT_MODEL
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_SAAS_TIMEOUT_MS
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey)
  }

  async healthcheck(): Promise<boolean> {
    if (!this.isConfigured()) return false
    try {
      await this.generate({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 16 })
      return true
    } catch {
      return false
    }
  }

  async generate(req: TextGenerateRequest): Promise<TextGenerateResult> {
    if (!this.isConfigured()) throw new Error('Gemini API 키가 설정되지 않았습니다')
    const started = Date.now()
    const client = new GoogleGenAI({ apiKey: this.apiKey })

    // Gemini 는 system 이 systemInstruction 으로 분리되고, 대화는 role: 'user' | 'model'.
    const system = [req.system, ...req.messages.filter((m) => m.role === 'system').map((m) => m.content)]
      .filter(Boolean)
      .join('\n\n')
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
    if (contents.length === 0) throw new Error('Gemini 요청에 user 메시지가 필요합니다')

    const response = await withTimeout(
      (signal) =>
        client.models.generateContent({
          model: this.model,
          contents,
          config: {
            systemInstruction: system || undefined,
            maxOutputTokens: req.maxTokens,
            temperature: req.temperature,
            responseMimeType: req.responseFormat === 'json' ? 'application/json' : undefined,
            abortSignal: signal,
          },
        }),
      this.timeoutMs,
      req.abortSignal
    )

    const content = response.text
    if (typeof content !== 'string' || !content) {
      throw new Error('Gemini 응답에 텍스트가 없습니다')
    }

    return {
      content,
      model: this.model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
      latencyMs: Date.now() - started,
    }
  }
}
