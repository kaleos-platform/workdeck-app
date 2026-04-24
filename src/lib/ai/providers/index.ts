// AI 공급자 레이어. TextProvider / ImageProvider 인터페이스 + factory.
// 외부 LLM SaaS 금지 — Claude Code ACP(1순위) + Ollama(fallback) + Gemini(이미지).

import { ClaudeCodeACPProvider } from './text-claude-code-acp'
import { OllamaProvider } from './text-ollama'
import { GeminiImageProvider } from './image-gemini'

// ─── 텍스트 ────────────────────────────────────────────────────────────────────

export type TextMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TextGenerateRequest {
  system?: string
  messages: TextMessage[]
  responseFormat?: 'text' | 'json'
  maxTokens?: number
  temperature?: number
  abortSignal?: AbortSignal
}

export interface TextGenerateUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface TextGenerateResult {
  content: string
  usage?: TextGenerateUsage
  model?: string
  latencyMs: number
}

export interface TextProvider {
  readonly name: string // 'claude-code-acp' | 'ollama'
  isConfigured(): boolean
  healthcheck(signal?: AbortSignal): Promise<boolean>
  generate(req: TextGenerateRequest): Promise<TextGenerateResult>
}

// ─── 이미지 ────────────────────────────────────────────────────────────────────

export interface ImageGenerateRequest {
  prompt: string
  negativePrompt?: string
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
  numberOfImages?: number
  abortSignal?: AbortSignal
}

export interface GeneratedImage {
  bytes: Buffer // 원본 바이트 — 저장은 Unit 7 책임
  mimeType: string // 'image/png' 등
}

export interface ImageGenerateResult {
  images: GeneratedImage[]
  model: string
  latencyMs: number
}

export interface ImageProvider {
  readonly name: string
  isConfigured(): boolean
  generate(req: ImageGenerateRequest): Promise<ImageGenerateResult>
}

// ─── Factory ───────────────────────────────────────────────────────────────────

// Text provider 선택: ACP 구성 + 헬스체크 통과 → ACP. 아니면 Ollama. 둘 다 실패 시 throw.
export async function selectTextProvider(): Promise<TextProvider> {
  const acp = new ClaudeCodeACPProvider()
  if (acp.isConfigured()) {
    const healthy = await acp.healthcheck().catch(() => false)
    if (healthy) return acp
  }
  const ollama = new OllamaProvider()
  if (ollama.isConfigured()) return ollama
  throw new Error('사용 가능한 텍스트 AI 공급자가 구성되지 않았습니다')
}

// ACP healthcheck 실패 시 Ollama로 자동 폴백하면서 한 번 더 generate 시도.
export async function generateTextWithFallback(
  req: TextGenerateRequest
): Promise<{ result: TextGenerateResult; providerName: string }> {
  const acp = new ClaudeCodeACPProvider()
  const ollama = new OllamaProvider()

  if (acp.isConfigured()) {
    try {
      if (await acp.healthcheck(req.abortSignal)) {
        const result = await acp.generate(req)
        return { result, providerName: acp.name }
      }
    } catch {
      // ACP 실패 → Ollama fallback
    }
  }

  if (!ollama.isConfigured()) {
    throw new Error('ACP 실패 후 Ollama도 구성되지 않아 텍스트 생성을 완료할 수 없습니다')
  }
  const result = await ollama.generate(req)
  return { result, providerName: ollama.name }
}

// 이미지는 현재 Gemini 하나. 구성되지 않은 경우 명확히 실패.
export function selectImageProvider(): ImageProvider {
  const gemini = new GeminiImageProvider()
  if (!gemini.isConfigured()) {
    throw new Error('GOOGLE_AI_API_KEY가 설정되지 않아 이미지 생성을 사용할 수 없습니다')
  }
  return gemini
}

export { ClaudeCodeACPProvider } from './text-claude-code-acp'
export { OllamaProvider } from './text-ollama'
export { GeminiImageProvider } from './image-gemini'
