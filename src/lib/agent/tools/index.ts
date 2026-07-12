import type { ToolDefinition } from './types'
import { whoamiTool } from './whoami'
import { financeTools } from './finance-tools'
import { sellerHubTools } from './seller-hub-tools'
import { coupangAdsTools } from './coupang-ads-tools'

export type { ToolMode, McpToolContext, ToolDefinition } from './types'

/**
 * 전체 tool 정의 단일 소스.
 * deck별 파일(finance/seller-hub/coupang-ads)이 자신의 ToolDefinition[] 를
 * export하고 여기에 spread로 합친다.
 */
export const toolDefinitions: ToolDefinition[] = [
  whoamiTool,
  ...financeTools,
  ...sellerHubTools,
  ...coupangAdsTools,
]
