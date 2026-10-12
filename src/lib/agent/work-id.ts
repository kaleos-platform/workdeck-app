import { randomUUID } from 'node:crypto'

// 작업 상관 ID — Slack 요청 → MCP 호출 → 승인 → Job까지 같은 값을 쓴다.
export function newWorkId(): string {
  return `wk_${randomUUID()}`
}
