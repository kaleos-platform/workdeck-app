// AI 공급자 레이어. TextProvider / ImageProvider 인터페이스 + factory.
// 외부 LLM SaaS 금지 — codex CLI(1순위) → gemini CLI(2순위) → Ollama 맥미니(최종).
// 모두 로컬/self-host exec: child_process.execFile 인자 배열, 외부 API 키 HTTP 호출 없음.

import { CodexCliProvider } from './text-codex'
import { GeminiCliProvider } from './text-gemini'
import { OllamaProvider } from './text-ollama'
import { ClaudeCodeACPProvider } from './text-claude-code-acp'
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
  readonly name: string
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

// Text provider 선택: codex → gemini-cli → ollama 순서로 첫 번째 isConfigured() 반환.
export async function selectTextProvider(): Promise<TextProvider> {
  const codex = new CodexCliProvider()
  if (codex.isConfigured()) {
    const healthy = await codex.healthcheck().catch(() => false)
    if (healthy) return codex
  }
  const gemini = new GeminiCliProvider()
  if (gemini.isConfigured()) {
    const healthy = await gemini.healthcheck().catch(() => false)
    if (healthy) return gemini
  }
  const ollama = new OllamaProvider()
  if (ollama.isConfigured()) return ollama
  throw new Error('사용 가능한 텍스트 AI 공급자가 구성되지 않았습니다')
}

// codex → gemini-cli → ollama 순차 폴백. 각 단계 실패 시 다음으로 넘어감.
// 모두 실패하면 throw. 시그니처 변경 금지 (발주 예측·ideation·insights 공유).
export async function generateTextWithFallback(
  req: TextGenerateRequest
): Promise<{ result: TextGenerateResult; providerName: string }> {
  const errors: string[] = []

  // 1순위: codex CLI
  const codex = new CodexCliProvider()
  if (codex.isConfigured()) {
    try {
      const result = await codex.generate(req)
      return { result, providerName: codex.name }
    } catch (err) {
      errors.push(`codex: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 2순위: gemini CLI
  const gemini = new GeminiCliProvider()
  if (gemini.isConfigured()) {
    try {
      const result = await gemini.generate(req)
      return { result, providerName: gemini.name }
    } catch (err) {
      errors.push(`gemini-cli: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 최종: ollama (맥미니 self-host)
  const ollama = new OllamaProvider()
  if (!ollama.isConfigured()) {
    throw new Error(
      `모든 텍스트 AI 공급자 실패. ollama도 구성되지 않음. 오류: ${errors.join(' | ')}`
    )
  }
  try {
    const result = await ollama.generate(req)
    return { result, providerName: ollama.name }
  } catch (err) {
    errors.push(`ollama: ${err instanceof Error ? err.message : String(err)}`)
    throw new Error(`모든 텍스트 AI 공급자 실패: ${errors.join(' | ')}`)
  }
}

// 이미지는 현재 Gemini Imagen 하나. 구성되지 않은 경우 명확히 실패.
export function selectImageProvider(): ImageProvider {
  const gemini = new GeminiImageProvider()
  if (!gemini.isConfigured()) {
    throw new Error('GOOGLE_AI_API_KEY가 설정되지 않아 이미지 생성을 사용할 수 없습니다')
  }
  return gemini
}

export { ClaudeCodeACPProvider } from './text-claude-code-acp'
export { CodexCliProvider } from './text-codex'
export { GeminiCliProvider } from './text-gemini'
export { OllamaProvider } from './text-ollama'
export { GeminiImageProvider } from './image-gemini'
