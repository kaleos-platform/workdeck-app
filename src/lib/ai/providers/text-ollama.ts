// 로컬 Ollama 기반 텍스트 공급자 (ACP 실패 시 fallback).
// Spec: https://github.com/ollama/ollama/blob/main/docs/api.md (POST /api/chat)

import type { TextProvider, TextGenerateRequest, TextGenerateResult } from './index'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'
const DEFAULT_MODEL = 'llama3.1:8b'
const CHAT_PATH = '/api/chat'

export class OllamaProvider implements TextProvider {
  readonly name = 'ollama'
  private readonly endpoint: string
  private readonly model: string

  constructor(opts?: { endpoint?: string; model?: string }) {
    this.endpoint = (opts?.endpoint ?? process.env.OLLAMA_ENDPOINT ?? DEFAULT_ENDPOINT).replace(
      /\/$/,
      ''
    )
    this.model = opts?.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint)
  }

  async healthcheck(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, { method: 'GET', signal })
      return res.ok
    } catch {
      return false
    }
  }

  async generate(req: TextGenerateRequest): Promise<TextGenerateResult> {
    const started = Date.now()
    const messages: { role: string; content: string }[] = []
    if (req.system) messages.push({ role: 'system', content: req.system })
    for (const m of req.messages) messages.push({ role: m.role, content: m.content })

    const res = await fetch(`${this.endpoint}${CHAT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: req.responseFormat === 'json' ? 'json' : undefined,
        options: {
          num_predict: req.maxTokens,
          temperature: req.temperature,
        },
      }),
      signal: req.abortSignal,
    })
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 500)}`)
    }
    const data = (await res.json()) as {
      message?: { role?: string; content?: string }
      prompt_eval_count?: number
      eval_count?: number
      model?: string
    }
    const content = data.message?.content
    if (typeof content !== 'string') {
      throw new Error('Ollama 응답에 message.content 가 없습니다')
    }
    return {
      content,
      model: data.model ?? this.model,
      usage: {
        inputTokens: data.prompt_eval_count,
        outputTokens: data.eval_count,
      },
      latencyMs: Date.now() - started,
    }
  }
}
