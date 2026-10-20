/**
 * POST /api/agent/actions/bulk — { action: "approve" | "reject", actionIds: string[] (1..20, 중복 불가) }
 * 지출 액션은 일괄 승인에서 제외(forbidden — 한 건씩 승인). 일괄 거절은 허용.
 *
 * 항목마다 단건 PATCH와 같은 decideAction을 순차 실행한다(외부 쓰기라 병렬 금지).
 * 한 건이 실패해도 나머지는 계속 처리하고, 항목별 결과를 돌려준다(배치 전체를 500으로 만들지 않는다).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUser } from '@/hooks/use-user'
import { errorResponse } from '@/lib/api-helpers'
import { decideAction } from '@/lib/agent/actions/decide'
import type { DecisionOutcome } from '@/lib/agent/actions/execute'

export const maxDuration = 300

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  actionIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, '중복된 actionId가 있습니다'),
})

type BulkItemStatus = 'ok' | 'forbidden' | 'conflict' | 'not_found' | 'failed'
type BulkItemResult = {
  actionId: string
  ok: boolean
  status: BulkItemStatus
  message: string
  outcome?: DecisionOutcome
}

function classify(actionId: string, r: Awaited<ReturnType<typeof decideAction>>): BulkItemResult {
  if (r.error !== undefined) {
    return {
      actionId,
      ok: false,
      status: r.status === 404 ? 'not_found' : 'forbidden',
      message: r.error,
    }
  }
  const o = r.outcome
  const base = { actionId, outcome: o }
  switch (o.status) {
    case 'EXECUTED':
      return { ...base, ok: true, status: 'ok', message: '승인 후 실행 완료' }
    case 'REJECTED':
      return { ...base, ok: true, status: 'ok', message: '거절됨' }
    case 'FORBIDDEN':
      return {
        ...base,
        ok: false,
        status: 'forbidden',
        message: o.message.includes('OWNER') ? 'OWNER 승인 필요' : o.message,
      }
    case 'CONFLICT':
    case 'EXPIRED':
      return { ...base, ok: false, status: 'conflict', message: o.message }
    case 'BLOCKED':
      return { ...base, ok: false, status: 'failed', message: o.message }
    case 'FAILED':
      return { ...base, ok: false, status: 'failed', message: o.error }
  }
}

// 남은 항목을 시작하지 않는 기준 — maxDuration(300초) 안에 응답을 돌려주기 위한 여유.
const TIME_BUDGET_MS = 240_000

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)
  if (!req.headers.get('content-type')?.startsWith('application/json')) {
    return errorResponse('Content-Type은 application/json이어야 합니다', 415)
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('action(approve|reject)과 actionIds(1~20개, 중복 불가)가 필요합니다', 422)
  }
  const { action: decision, actionIds } = parsed.data

  const deadline = Date.now() + TIME_BUDGET_MS
  const results: BulkItemResult[] = []
  for (const actionId of actionIds) {
    if (Date.now() > deadline) {
      results.push({
        actionId,
        ok: false,
        status: 'failed',
        message: '시간 초과로 처리하지 않았습니다(대기 상태 유지)',
      })
      continue
    }
    try {
      const r = await decideAction(user.id, actionId, decision, { excludeSpendApprove: true })
      results.push(classify(actionId, r))
    } catch (err) {
      // 실행 뒤(결과 기록 단계)에 터졌을 수 있다 — 실패로 단정하지 않고 상태 재확인을 안내한다.
      console.error('[agent/actions/bulk] 항목 처리 실패', actionId, err)
      results.push({
        actionId,
        ok: false,
        status: 'failed',
        message: '실행 결과 확인 필요(상태를 다시 확인하세요)',
      })
    }
  }
  return NextResponse.json({ results })
}
