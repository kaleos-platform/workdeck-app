// Gemini CLI 기반 텍스트 공급자 (2순위).
// child_process.spawn + 인자 배열로 실행 — shell 문자열 보간 없음 (command injection 방어).
// 프롬프트는 stdin pipe로 전달하여 인자 길이 제한 및 injection 위험 회피.
// --output-format json stdout을 다중 후보 안전 파싱으로 처리.

import { spawn } from 'child_process'
import * as fs from 'fs'
import type { TextProvider, TextGenerateRequest, TextGenerateResult } from './index'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MODEL = 'gemini-2.0-flash'

/**
 * system + messages를 단일 프롬프트 문자열로 직렬화.
 */
function flattenPrompt(req: TextGenerateRequest): string {
  const parts: string[] = []
  if (req.system) {
    parts.push(`[SYSTEM]\n${req.system}`)
  }
  for (const m of req.messages) {
    const label =
      m.role === 'assistant' ? '[ASSISTANT]' : m.role === 'system' ? '[SYSTEM]' : '[USER]'
    parts.push(`${label}\n${m.content}`)
  }
  if (req.responseFormat === 'json') {
    parts.push('[INSTRUCTION]\nRespond with valid JSON only. No prose, no markdown fences.')
  }
  return parts.join('\n\n')
}

/**
 * gemini --output-format json stdout에서 텍스트 추출.
 * 실제 응답 envelope 구조가 버전마다 다를 수 있으므로 다중 후보 안전 파싱.
 * 에러 응답(data.error) 시 throw.
 */
function extractGeminiText(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('gemini: stdout이 비어있습니다')

  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // JSON 파싱 실패 → raw stdout을 그대로 반환 (text 모드 fallback)
    return trimmed
  }

  // 에러 응답 처리
  if (parsed.error && typeof parsed.error === 'object') {
    const err = parsed.error as Record<string, unknown>
    throw new Error(`gemini CLI 오류: ${err.message ?? JSON.stringify(err)}`)
  }

  // 다중 후보 파싱: 실제 응답 필드 순서대로 시도
  for (const key of ['response', 'text', 'content', 'message', 'result', 'output']) {
    const val = parsed[key]
    if (typeof val === 'string' && val.trim()) {
      return val.trim()
    }
  }

  // choices 배열 구조 탐색 (OpenAI 호환 형식)
  if (Array.isArray(parsed.choices)) {
    const first = (parsed.choices as Record<string, unknown>[])[0]
    if (first) {
      for (const key of ['text', 'content', 'message']) {
        const val = first[key]
        if (typeof val === 'string' && val.trim()) return val.trim()
        if (val && typeof val === 'object') {
          const nested = (val as Record<string, unknown>).content
          if (typeof nested === 'string' && nested.trim()) return nested.trim()
        }
      }
    }
  }

  // 모든 후보 실패 → raw JSON 원본 반환 (호출자가 처리)
  return trimmed
}

/**
 * spawn으로 프로세스 실행 + stdin 파이프 + timeout + abortSignal 처리.
 * 인자는 배열로 전달 — shell: false (기본값), command injection 불가.
 */
function spawnWithStdin(
  bin: string,
  args: string[],
  stdinData: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // injection 방어: shell 해석 없음
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`gemini: ${timeoutMs}ms 타임아웃 초과`))
    }, timeoutMs)

    const onAbort = () => {
      child.kill('SIGTERM')
      clearTimeout(timer)
      reject(new Error('gemini: 요청이 중단되었습니다 (abortSignal)'))
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
        return
      }
      abortSignal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (err) => {
      clearTimeout(timer)
      abortSignal?.removeEventListener('abort', onAbort)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      abortSignal?.removeEventListener('abort', onAbort)
      resolve({ stdout, stderr, code: code ?? 1 })
    })

    // 프롬프트를 stdin으로 전달 — 인자에 사용자 데이터 없음
    child.stdin.end(stdinData, 'utf-8')
  })
}

export class GeminiCliProvider implements TextProvider {
  readonly name = 'gemini-cli'
  private readonly binPath: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(opts?: { bin?: string; model?: string; timeoutMs?: number }) {
    this.binPath = opts?.bin ?? process.env.GEMINI_BIN ?? '/opt/homebrew/bin/gemini'
    this.model = opts?.model ?? process.env.GEMINI_TEXT_MODEL ?? DEFAULT_MODEL
    this.timeoutMs = opts?.timeoutMs ?? Number(process.env.GEMINI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  }

  isConfigured(): boolean {
    try {
      return fs.existsSync(this.binPath)
    } catch {
      return false
    }
  }

  async healthcheck(_signal?: AbortSignal): Promise<boolean> {
    if (!this.isConfigured()) return false
    try {
      const { code } = await spawnWithStdin(this.binPath, ['--version'], '', 5_000)
      return code === 0
    } catch {
      return false
    }
  }

  async generate(req: TextGenerateRequest): Promise<TextGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error(`gemini 바이너리를 찾을 수 없습니다: ${this.binPath}`)
    }

    const started = Date.now()
    const prompt = flattenPrompt(req)

    // 인자 배열 — shell: false, 사용자 데이터는 stdin으로만 전달 (injection 방어)
    // gemini는 -p ""(빈 문자열) + stdin을 합쳐서 프롬프트로 처리
    // rationale 생성은 순수 텍스트 작업 → read-only(plan) 모드로 파일 수정/명령
    // 실행 도구를 차단한다 (필요 최소 권한). --yolo(전체 자동 승인) 사용 금지.
    const args = [
      '--prompt',
      '',
      '--model',
      this.model,
      '--output-format',
      'json',
      '--approval-mode',
      'plan',
    ]

    const { stdout, code, stderr } = await spawnWithStdin(
      this.binPath,
      args,
      prompt,
      this.timeoutMs,
      req.abortSignal
    )

    if (code !== 0) {
      // stderr 또는 stdout의 JSON error 구조에서 메시지 추출 시도
      let errMsg = stderr.slice(0, 500)
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>
        if (parsed.error && typeof parsed.error === 'object') {
          const e = parsed.error as Record<string, unknown>
          errMsg = String(e.message ?? errMsg)
        }
      } catch {
        /* 무시 */
      }
      throw new Error(`gemini CLI 종료 코드 ${code}: ${errMsg}`)
    }

    const content = extractGeminiText(stdout)

    return {
      content,
      model: this.model,
      latencyMs: Date.now() - started,
    }
  }
}
