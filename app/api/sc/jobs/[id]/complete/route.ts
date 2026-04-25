import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, resolveWorkerAuth } from '@/lib/api-helpers'
import { completeJob, failJob, isRetryableErrorCode } from '@/lib/sc/jobs'
import { prisma } from '@/lib/prisma'
import { notifyJobFailure } from '@/lib/sc/notifications'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  ok: z.boolean(),
  errorMessage: z.string().max(1000).optional(),
  // Publisher/Collector 의 errorCode (AUTH_FAILED 등). non-retryable 판정에 사용.
  errorCode: z.string().max(50).optional(),
  // publish 성공 시 platformUrl 을 같이 보내면 ContentDeployment 에 채운다.
  platformUrl: z.string().url().max(2000).optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  const { id } = await params
  const job = await prisma.salesContentJob.findUnique({ where: { id } })
  if (!job) return errorResponse('job 이 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  if (parsed.data.ok) {
    const { updated } = await completeJob(id)
    if (!updated) {
      // 이미 종료된 job 의 중복 보고 — deployment 상태를 덮어쓰지 않는다 (P0 fix).
      return NextResponse.json({ ok: true, noop: true })
    }
    if (job.kind === 'PUBLISH' && job.targetId) {
      // updateMany 로 status filter 적용 — 이미 PUBLISHED/FAILED 인 deployment 는 덮어쓰지 않음.
      await prisma.contentDeployment.updateMany({
        where: { id: job.targetId, status: 'PUBLISHING' },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          platformUrl: parsed.data.platformUrl ?? undefined,
          errorMessage: null,
        },
      })
    }
    return NextResponse.json({ ok: true })
  }

  const nonRetryable = !isRetryableErrorCode(parsed.data.errorCode)
  const errorMessage = parsed.data.errorMessage ?? '알 수 없는 오류'
  const { updated, finalized } = await failJob(id, errorMessage, { nonRetryable })

  if (!updated) {
    // 이미 종료된 job — deployment/notify 전부 스킵 (중복 보고 무시).
    return NextResponse.json({ ok: true, noop: true })
  }

  // PUBLISH 의 deployment 는 finalized(즉 status=FAILED 로 떨어졌을 때)에만 동기화.
  // retryable 실패는 다음 재시도 동안 PUBLISHING 유지 — UI 가 일시 FAILED 로 깜빡이지 않게.
  if (finalized && job.kind === 'PUBLISH' && job.targetId) {
    try {
      await prisma.contentDeployment.updateMany({
        where: { id: job.targetId, status: 'PUBLISHING' },
        data: {
          status: 'FAILED',
          errorMessage: errorMessage.slice(0, 1000),
        },
      })
    } catch (err) {
      // deployment update 실패가 알림을 막지 않도록 swallow + 로그.
      console.error('[complete] ContentDeployment 업데이트 실패:', err)
    }
  }

  // non-retryable 실패만 알림 — retryable 실패는 백오프로 자동 회복하므로 알림 노이즈 회피.
  // notify 는 deployment update 와 독립적으로 실행 (P1 fix: update 실패가 알림 차단 안 하게).
  if (nonRetryable) {
    void notifyJobFailure({
      jobId: id,
      jobKind: job.kind,
      errorCode: parsed.data.errorCode,
      errorMessage,
      targetId: job.targetId,
      spaceId: job.spaceId,
    })
  }

  return NextResponse.json({ ok: true })
}
