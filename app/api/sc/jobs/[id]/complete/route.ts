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
    await completeJob(id)
    // PUBLISH 성공 시 ContentDeployment 상태 업데이트
    if (job.kind === 'PUBLISH' && job.targetId) {
      await prisma.contentDeployment.update({
        where: { id: job.targetId },
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
  await failJob(id, errorMessage, { nonRetryable })
  if (job.kind === 'PUBLISH' && job.targetId) {
    await prisma.contentDeployment.update({
      where: { id: job.targetId },
      data: {
        status: 'FAILED',
        errorMessage: errorMessage.slice(0, 1000),
      },
    })
  }

  // non-retryable 실패만 알림 — retryable 실패는 백오프로 자동 회복하므로 알림 노이즈 회피.
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
