// 승인 큐 UI 공용 타입 — /api/agent/actions 응답 shape과 일치시킨다.

export type AgentActionStatusValue =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'FAILED'
  | 'EXPIRED'

export type AgentActionSourceValue = 'MCP' | 'WORKDECK_AGENT' | 'WEB' | 'SYSTEM'

export type AgentPendingActionDTO = {
  id: string
  spaceId: string
  deckKey: string
  actionType: string
  payload: unknown
  summary: string
  beforeState: unknown
  source: AgentActionSourceValue
  actorType: string
  actorId: string
  requesterUserId: string | null
  actorLabel: string // 사람이 읽는 "행위자 · 요청자" (서버 describeActors)
  spendKrw?: number | null // 지출 액션의 금액(원) — 지출이 아니면 null
  requiredRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null // 승인에 필요한 역할(대기중일 때만)
  status: AgentActionStatusValue
  expiresAt: string
  decidedBy: string | null
  decidedAt: string | null
  executedAt: string | null
  result: unknown
  error: string | null
  createdAt: string
  updatedAt: string
}

export const DECK_LABELS: Record<string, string> = {
  finance: '재무 관리',
  'seller-hub': '브랜드 운영',
  'coupang-ads': '쿠팡 광고 관리',
  'meta-ads': '메타 광고',
  'google-marketing': '구글 마케팅',
  'sales-content': '세일즈 콘텐츠',
  secrets: '비밀값',
}

export const SOURCE_LABELS: Record<AgentActionSourceValue, string> = {
  MCP: 'MCP',
  WORKDECK_AGENT: '워크덱 에이전트',
  WEB: '웹',
  SYSTEM: '시스템',
}

export const STATUS_LABELS: Record<AgentActionStatusValue, string> = {
  PENDING: '대기중',
  APPROVED: '승인됨',
  REJECTED: '거부됨',
  EXECUTED: '실행됨',
  FAILED: '실패',
  EXPIRED: '만료됨',
}

// POST /api/agent/actions/bulk 항목별 결과.
export type BulkDecisionResult = {
  actionId: string
  ok: boolean
  status: 'ok' | 'forbidden' | 'conflict' | 'not_found' | 'failed'
  message: string
}

export const BULK_LIMIT = 20
