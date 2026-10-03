import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import type { AnalysisType } from '@/generated/prisma/enums'

// 제네릭 파라미터 액션을 배열(ActionDefinition[])에 담기 위한 위더너(finance.ts와 동일 패턴).
function def<T>(d: ActionDefinition<T>): ActionDefinition {
  return d as unknown as ActionDefinition
}

// ─── 4) coupang-ads.analysis.trigger ────────────────────────────────────────
// 재사용: app/api/analysis/trigger/route.ts POST의 실 로직(analysisReport.create PENDING).
// 워크스페이스 스코프라 workspaceId 필요 — Phase 5 write tool이 resolveMcpWorkspace로
// workspaceId를 구해 payload에 넣는다. execute는 그 workspaceId 실재 검증 후 생성.
const analysisTriggerParams = z.object({
  workspaceId: z.string(),
  from: z.string(),
  to: z.string(),
  reportType: z
    .enum(['DAILY_REVIEW', 'KEYWORD_AUDIT', 'BUDGET_OPTIMIZATION', 'CAMPAIGN_SCORING'])
    .optional(),
})

const analysisTrigger: ActionDefinition<z.infer<typeof analysisTriggerParams>> = {
  actionType: 'coupang-ads.analysis.trigger',
  deckKey: 'coupang-ads',
  title: 'AI 분석 실행',
  paramsSchema: analysisTriggerParams,
  requiredRole: 'ADMIN',
  execute: async (_ctx, params) => {
    // 워크스페이스 실재 검증 — 임의 UUID 트리거 방지.
    const ws = await prisma.workspace.findUnique({
      where: { id: params.workspaceId },
      select: { id: true },
    })
    if (!ws) throw new Error('워크스페이스를 찾을 수 없습니다')

    const reportType = (params.reportType ?? 'DAILY_REVIEW') as AnalysisType
    const periodStart = new Date(params.from + 'T00:00:00+09:00')
    const periodEnd = new Date(params.to + 'T23:59:59+09:00')

    const report = await prisma.analysisReport.create({
      data: {
        workspaceId: ws.id,
        periodStart,
        periodEnd,
        reportType,
        summary: '',
        suggestions: [],
        status: 'PENDING',
        triggeredBy: 'agent',
      },
      select: { id: true },
    })

    return { reportId: report.id, status: 'PENDING' }
  },
}

// ─── 5) coupang-ads.execution.approve ───────────────────────────────────────
// 재사용: app/api/execution/tasks/[taskId]/route.ts PATCH 승인 로직(PENDING_APPROVAL →
//   APPROVED, approvedAt/By 설정). 워커가 브라우저로 실행하므로 여기선 상태 전이만.
const executionApproveParams = z.object({
  taskId: z.string(),
  workspaceId: z.string(),
})

const executionApprove: ActionDefinition<z.infer<typeof executionApproveParams>> = {
  actionType: 'coupang-ads.execution.approve',
  deckKey: 'coupang-ads',
  title: '실행 태스크 승인',
  paramsSchema: executionApproveParams,
  requiredRole: 'ADMIN',
  execute: async (ctx, params) => {
    // workspaceId 스코프로 소유 검증.
    const task = await prisma.executionTask.findFirst({
      where: { id: params.taskId, workspaceId: params.workspaceId },
      select: { id: true, status: true },
    })
    if (!task) throw new Error('태스크를 찾을 수 없습니다')
    if (task.status !== 'PENDING_APPROVAL') {
      throw new Error('승인 대기 상태의 태스크만 처리할 수 있습니다')
    }

    await prisma.executionTask.update({
      where: { id: task.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: ctx.requestedBy,
      },
    })

    return { taskId: task.id, status: 'APPROVED' }
  },
}

// coupang-ads deck 승인 큐 액션.
export const coupangAdsActions: ActionDefinition[] = [
  def(analysisTrigger),
  def(executionApprove),
]
