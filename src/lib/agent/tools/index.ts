import type { ToolDefinition } from './types'
import { whoamiTool } from './whoami'

export type { ToolMode, McpToolContext, ToolDefinition } from './types'

/**
 * 전체 tool 정의 단일 소스.
 * 이후 phase에서 deck별 파일(finance/seller-hub/coupang-ads 등)이
 * 자신의 ToolDefinition[] 를 export하면 여기에 spread로 합친다.
 */
export const toolDefinitions: ToolDefinition[] = [whoamiTool]
