export type ActionType =
  | 'REMOVE_KEYWORD'
  | 'ADJUST_BID'
  | 'PAUSE_CAMPAIGN'
  | 'RESUME_CAMPAIGN'
  | 'ADJUST_BUDGET'

export type ExecutionStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK'

export interface ExecutionTask {
  id: string
  workspaceId: string
  analysisReportId?: string
  actionType: ActionType
  campaignId: string
  target: string
  params: Record<string, unknown>
  status: ExecutionStatus
  beforeState?: Record<string, unknown>
  afterState?: Record<string, unknown>
  approvedAt?: string
  approvedBy?: string
  executedAt?: string
  error?: string
  createdAt: string
}

export interface SafetyLimits {
  id: string
  maxBidChangePct: number
  maxKeywordsPerBatch: number
  maxBudgetChangePct: number
  requireApproval: boolean
}
