// Codex CLI 기반 텍스트 공급자 (1순위).
// child_process.spawn + 인자 배열로 실행 — shell 문자열 보간 없음 (command injection 방어).
// 프롬프트는 stdin pipe로 전달하여 인자 길이 제한 및 injection 위험 회피.
// 최종 응답은 --output-last-message 임시 파일로 수신, finally에서 정리.

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { TextProvider, TextGenerateRequest, TextGenerateResult } from './index'

const DEFAULT_TIMEOUT_MS = 60_000

/**
 * system + messages를 단일 프롬프트 문자열로 직렬화.
 * 역할 레이블을 명시하여 codex가 컨텍스트를 이해하도록 한다.
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
      reject(new Error(`codex: ${timeoutMs}ms 타임아웃 초과`))
    }, timeoutMs)

    const onAbort = () => {
      child.kill('SIGTERM')
      clearTimeout(timer)
      reject(new Error('codex: 요청이 중단되었습니다 (abortSignal)'))
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

export class CodexCliProvider implements TextProvider {
  readonly name = 'codex'
  private readonly binPath: string
  private readonly timeoutMs: number

  constructor(opts?: { bin?: string; timeoutMs?: number }) {
    // isConfigured()는 동기 — 생성자에서 바이너리 경로 확정
    this.binPath = opts?.bin ?? process.env.CODEX_BIN ?? '/opt/homebrew/bin/codex'
    this.timeoutMs = opts?.timeoutMs ?? Number(process.env.CODEX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
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
      // 버전 체크: 가볍고 빠름
      const { code } = await spawnWithStdin(this.binPath, ['--version'], '', 5_000)
      return code === 0
    } catch {
      return false
    }
  }

  async generate(req: TextGenerateRequest): Promise<TextGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error(`codex 바이너리를 찾을 수 없습니다: ${this.binPath}`)
    }

    const started = Date.now()
    const tmpFile = path.join(os.tmpdir(), `codex-out-${randomUUID()}.txt`)

    // 인자 배열 — shell: false, 사용자 데이터는 stdin으로만 전달 (injection 방어)
    // rationale 생성은 순수 텍스트 작업 → read-only sandbox + 자동 승인 비활성으로
    // 파일 쓰기/명령 실행 권한을 차단한다 (필요 최소 권한).
    const args = [
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '-o',
      tmpFile,
      '-', // stdin에서 프롬프트 읽기
    ]

    const prompt = flattenPrompt(req)

    try {
      const { code, stderr } = await spawnWithStdin(
        this.binPath,
        args,
        prompt,
        this.timeoutMs,
        req.abortSignal
      )

      if (code !== 0) {
        throw new Error(`codex 종료 코드 ${code}: ${stderr.slice(0, 500)}`)
      }

      // 출력 파일 읽기
      let content: string
      try {
        content = fs.readFileSync(tmpFile, 'utf-8').trim()
      } catch {
        throw new Error('codex: --output-last-message 파일을 읽을 수 없습니다')
      }

      if (!content) {
        throw new Error('codex: 응답 내용이 비어있습니다')
      }

      return {
        content,
        model: 'codex',
        latencyMs: Date.now() - started,
      }
    } finally {
      // 임시 파일 정리 — 파일이 없어도 예외 무시
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* 무시 */
      }
    }
  }
}
