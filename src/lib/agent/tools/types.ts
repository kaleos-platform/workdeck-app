import type { z } from 'zod'

// tool의 부수효과 성격 — read(조회) / write(변경).
export type ToolMode = 'read' | 'write'

// tool executor에 주입되는 최소 실행 컨텍스트.
export interface McpToolContext {
  userId: string
}

/**
 * MCP tool 정의 단일 소스.
 * inputSchema는 registerTool에 그대로 넘길 raw shape(z.object로 감싸지 않음).
 * execute는 NextResponse가 아니라 순수 데이터를 반환하고, 실패는 throw로 신호한다.
 */
export interface ToolDefinition {
  name: string // {deck}_{동사}_{대상} 규약
  description: string // 한국어
  inputSchema: z.ZodRawShape // registerTool에 그대로 전달할 raw shape
  mode: ToolMode
  execute: (ctx: McpToolContext, params: Record<string, unknown>) => Promise<unknown>
}
