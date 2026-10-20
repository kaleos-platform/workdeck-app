/**
 * POST /api/agent/actions/bulk — { action: "approve" | "reject", actionIds: string[] (1..20, 중복 불가) }
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
    .array(z.string().min(1))
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

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('action(approve|reject)과 actionIds(1~20개, 중복 불가)가 필요합니다', 422)
  }
  const { action: decision, actionIds } = parsed.data

  const results: BulkItemResult[] = []
  for (const actionId of actionIds) {
    try {
      results.push(classify(actionId, await decideAction(user.id, actionId, decision)))
    } catch (err) {
      console.error('[agent/actions/bulk] 항목 처리 실패', actionId, err)
      results.push({
        actionId,
        ok: false,
        status: 'failed',
        message: '처리 중 오류가 발생했습니다',
      })
    }
  }
  return NextResponse.json({ results })
}
