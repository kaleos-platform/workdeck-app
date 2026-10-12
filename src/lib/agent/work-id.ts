import { randomUUID } from 'node:crypto'

// 작업 상관 ID — Slack 요청 → MCP 호출 → 승인 → Job까지 같은 값을 쓴다.
export function newWorkId(): string {
  return `wk_${randomUUID()}`
}

const WORK_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/

/** 클라이언트가 준 workId를 검증한다. 형식이 틀리면 null(서버가 새로 발급). */
export function normalizeWorkId(input: unknown): string | null {
  return typeof input === 'string' && WORK_ID_RE.test(input) ? input : null
}
