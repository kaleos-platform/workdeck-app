import type { ToolDefinition } from './types'
import { whoamiTool } from './whoami'
import { financeTools } from './finance-tools'
import { sellerHubTools } from './seller-hub-tools'
import { coupangAdsTools } from './coupang-ads-tools'
import { writeTools } from './write-tools'
import { slackTools } from './slack-tools'
import { metaAdsTools } from './meta-ads-tools'

export type { ToolMode, McpToolContext, ToolDefinition } from './types'

/**
 * 전체 tool 정의 단일 소스.
 * deck별 파일(finance/seller-hub/coupang-ads)이 자신의 ToolDefinition[] 를
 * export하고 여기에 spread로 합친다. writeTools는 mode:"write"(승인 큐 경유).
 * slackTools(slack_post)는 승인 큐를 거치지 않는 예외 — 등록 채널·대량 멘션 차단으로 제한한다.
 */
export const toolDefinitions: ToolDefinition[] = [
  whoamiTool,
  ...financeTools,
  ...sellerHubTools,
  ...coupangAdsTools,
  ...writeTools,
  ...slackTools,
  ...metaAdsTools,
]
