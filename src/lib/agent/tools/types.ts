import type { z } from 'zod'
import type { Actor, Scope } from '@/lib/agent/identity/principal'

// tool의 부수효과 성격 — read(조회) / write(변경 제안: 승인 큐 경유).
export type ToolMode = 'read' | 'write'

/**
 * tool executor에 주입되는 실행 컨텍스트. 도구는 spaceId만으로 데이터를 찾는다
 * (User → Space 재추론 금지: 두 Space에 속한 구성원·에이전트에서 다른 Space가 섞인다).
 */
export interface McpToolContext {
  spaceId: string
  actor: Actor
  scopes: readonly Scope[]
  workId: string
  requesterUserId: string | null
  requesterSlackUserId: string | null
  decryptedCredentialIds: string[]
}

/**
 * MCP tool 정의 단일 소스.
 * inputSchema는 registerTool에 그대로 넘길 raw shape(z.object로 감싸지 않음).
 * execute는 순수 데이터를 반환하고, 실패는 throw로 신호한다.
 */
export interface ToolDefinition {
  name: string // {deck}_{동사}_{대상} 규약
  description: string // 한국어
  inputSchema: z.ZodRawShape
  mode: ToolMode
  scope: Scope | null // null은 whoami만 — scope-contract 테스트가 강제
  execute: (ctx: McpToolContext, params: Record<string, unknown>) => Promise<unknown>
}
