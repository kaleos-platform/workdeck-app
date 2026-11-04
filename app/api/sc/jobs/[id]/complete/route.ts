import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { authenticateWorker, workerOwns } from '@/lib/worker-auth'
import { completeJob, failJob, isRetryableErrorCode, WORKER_ERROR_CODES } from '@/lib/sc/jobs'
import { prisma } from '@/lib/prisma'
import { notifyJobFailure } from '@/lib/sc/notifications'
import { completeManualDeployment } from '@/lib/sc/manual-publish'
import { notifyDeploymentThread } from '@/lib/sc/deployment-notify'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  ok: z.boolean(),
  errorMessage: z.string().max(1000).optional(),
  // Publisher/Collector 의 errorCode — non-retryable 판정에 사용.
  // 알 수 없는 코드는 거부해 워커-웹앱 contract 드리프트를 즉시 표면화.
  errorCode: z.enum(WORKER_ERROR_CODES).optional(),
  // publish 성공 시 platformUrl 을 같이 보내면 ContentDeployment 에 채운다.
  platformUrl: z.string().url().max(2000).optional(),
  // Aside 리허설: 네이버 임시저장까지만 했다.
  draftSaved: z.boolean().optional(),
})

const DRAFT_SAVED_MESSAGE = '네이버 임시저장까지 마쳤습니다(리허설). 확인·발행 후 글 주소를 넣어 주세요'

/**
 * Aside 배포를 사람 확인(게시 대기)으로 넘긴다. 사람이 네이버에서 직접 게시했을 수 있으므로
 * publishAttemptedAt 을 찍어 이후 취소→재실행해도 워커가 다시 발행하지 않게 잠근다.
 */
async function handOver(jobSpaceId: string, deploymentId: string, message: string) {
  await prisma.contentDeployment.updateMany({
    where: { id: deploymentId, spaceId: jobSpaceId, status: 'PUBLISHING' },
    data: {
      status: 'AWAITING_MANUAL',
      errorMessage: message.slice(0, 1000),
      publishAttemptedAt: new Date(),
    },
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authenticateWorker(req.headers)
  if ('error' in auth) return auth.error

  const { id } = await params
  const job = await prisma.salesContentJob.findUnique({ where: { id } })
  // 토큰 범위 밖 job 은 없는 것으로 본다(404, 존재 은닉)
  if (!job || !workerOwns(auth.scope, { spaceId: job.spaceId })) {
    return errorResponse('job 이 없습니다', 404)
  }

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

  let manualChannel = false
  let asideChannel = false
  // targetId 에는 FK 가 없다 — 다른 Space 의 배포를 가리키는 job 은 job·배포 어느 쪽도 갱신하지 않는다.
  // (배포가 이미 삭제됐으면 아래 updateMany 가 0건이라 job 만 종료한다 — 재선점 루프 방지)
  if (job.kind === 'PUBLISH' && job.targetId) {
    const target = await prisma.contentDeployment.findUnique({
      where: { id: job.targetId },
      select: { spaceId: true, channel: { select: { publisherMode: true } } },
    })
    if (target && target.spaceId !== job.spaceId) return errorResponse('job 이 없습니다', 404)
    manualChannel = target?.channel?.publisherMode === 'MANUAL'
    asideChannel = target?.channel?.publisherMode === 'ASIDE'
  }

  if (parsed.data.ok) {
    // Aside: 배포 상태를 먼저 남기고 job 을 닫는다(사이에서 죽으면 job 이 CLAIMED 로 남아 재선점되고,
    // 워커는 publishAttemptedAt 을 보고 사람 확인으로 넘긴다). 이미 끝난 job 의 중복 보고는 무시.
    if (job.kind === 'PUBLISH' && job.targetId && asideChannel) {
      if (job.status !== 'CLAIMED') return NextResponse.json({ ok: true, noop: true })
      const deploymentId = job.targetId
      if (parsed.data.draftSaved) {
        await handOver(job.spaceId, deploymentId, DRAFT_SAVED_MESSAGE)
        await completeJob(id)
        await notifyDeploymentThread(deploymentId, { kind: 'draft-saved' })
        return NextResponse.json({ ok: true })
      }
      const done = parsed.data.platformUrl
        ? await completeManualDeployment({
            spaceId: job.spaceId,
            deploymentId,
            platformUrl: parsed.data.platformUrl,
            fromStatus: 'PUBLISHING',
          })
        : null
      const message = '발행 후 글 주소를 확인하지 못했습니다. 블로그에서 게시 여부를 확인해 주세요'
      if (!done?.ok) await handOver(job.spaceId, deploymentId, message)
      await completeJob(id)
      await notifyDeploymentThread(
        deploymentId,
        done?.ok
          ? { kind: 'published', platformUrl: done.platformUrl }
          : { kind: 'needs-review', message }
      )
      return NextResponse.json({ ok: true })
    }
    const { updated } = await completeJob(id)
    if (!updated) {
      // 이미 종료된 job 의 중복 보고 — deployment 상태를 덮어쓰지 않는다 (P0 fix).
      return NextResponse.json({ ok: true, noop: true })
    }
    if (job.kind === 'PUBLISH' && job.targetId) {
      // 수동 채널의 워커 성공은 "게시할 차례"일 뿐이다 — 사람이 게시 완료할 때까지 PUBLISHED 로 두지 않는다.
      // updateMany 로 status filter 적용 — 이미 PUBLISHED/FAILED 인 deployment 는 덮어쓰지 않음.
      await prisma.contentDeployment.updateMany({
        where: { id: job.targetId, spaceId: job.spaceId, status: 'PUBLISHING' },
        data: manualChannel
          ? { status: 'AWAITING_MANUAL', errorMessage: null }
          : {
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

  if (asideChannel && job.kind === 'PUBLISH' && job.targetId && parsed.data.errorCode === 'NEEDS_REVIEW') {
    if (job.status !== 'CLAIMED') return NextResponse.json({ ok: true, noop: true })
    await handOver(job.spaceId, job.targetId, errorMessage)
    await failJob(id, errorMessage, { nonRetryable: true })
    await notifyDeploymentThread(job.targetId, { kind: 'needs-review', message: errorMessage })
    return NextResponse.json({ ok: true })
  }
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
        where: { id: job.targetId, spaceId: job.spaceId, status: 'PUBLISHING' },
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
  if (finalized && asideChannel && job.kind === 'PUBLISH' && job.targetId) {
    await notifyDeploymentThread(job.targetId, { kind: 'failed', message: errorMessage })
  }
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
