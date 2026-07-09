import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, resolveWorkerAuth } from '@/lib/api-helpers'
import {
  completeBoJob,
  failBoJob,
  isBoRetryableErrorCode,
  BO_WORKER_ERROR_CODES,
} from '@/lib/bo/jobs'
import { prisma } from '@/lib/prisma'
import { assertBoPostTransition } from '@/lib/bo/post-state'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  ok: z.boolean(),
  errorMessage: z.string().max(1000).optional(),
  // Publisher 의 errorCode — non-retryable 판정에 사용
  errorCode: z.enum(BO_WORKER_ERROR_CODES).optional(),
  // 발행 성공 시 플랫폼 URL
  platformUrl: z.string().url().max(2000).optional(),
})

// POST /api/bo/jobs/[id]/complete — 워커 작업 완료 보고 (x-worker-api-key 인증)
export async function POST(req: NextRequest, { params }: Params) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  const { id } = await params
  const job = await prisma.boJob.findUnique({ where: { id } })
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
    const { updated } = await completeBoJob(id)
    if (!updated) {
      // 이미 종료된 job 의 중복 보고 — deployment 상태 덮어쓰지 않음
      return NextResponse.json({ ok: true, noop: true })
    }

    if (job.kind === 'PUBLISH' && job.targetId) {
      // deployment PUBLISHED 갱신 (status 가드 — 이미 변경된 경우 스킵)
      await prisma.boDeployment.updateMany({
        where: { id: job.targetId, status: 'PUBLISHING' },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          platformUrl: parsed.data.platformUrl ?? null,
          errorMessage: null,
          errorCode: null,
        },
      })

      // 포스트 상태 PUBLISHED 롤업 — PUBLISH_APPROVED → PUBLISHED 첫 성공 시
      const deployment = await prisma.boDeployment.findUnique({
        where: { id: job.targetId },
        select: { postId: true },
      })
      if (deployment) {
        const post = await prisma.boPost.findUnique({
          where: { id: deployment.postId },
          select: { id: true, status: true },
        })
        if (post && post.status !== 'PUBLISHED' && post.status !== 'ARCHIVED') {
          try {
            assertBoPostTransition(post.status, 'PUBLISHED')
            await prisma.boPost.update({
              where: { id: post.id },
              data: { status: 'PUBLISHED' },
            })
          } catch {
            // 전환 불가 상태(예: DRAFT) — 조용히 스킵, 로그만 기록
            console.warn(
              `[bo-jobs-complete] 포스트 ${post.id} PUBLISHED 롤업 불가: status=${post.status}`
            )
          }
        }
      }
    }

    if (job.kind === 'DELETE_POST' && job.targetId) {
      // deployment DELETED 갱신 (status 가드 — DELETING 인 경우만)
      await prisma.boDeployment.updateMany({
        where: { id: job.targetId, status: 'DELETING' },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      })

      // 포스트 롤업 — 남은 PUBLISHED 배포 0건이면 PUBLISH_APPROVED 로 회귀
      const deployment = await prisma.boDeployment.findUnique({
        where: { id: job.targetId },
        select: { postId: true },
      })
      if (deployment) {
        const post = await prisma.boPost.findUnique({
          where: { id: deployment.postId },
          select: { id: true, status: true },
        })
        if (post && post.status === 'PUBLISHED') {
          const remainingPublished = await prisma.boDeployment.count({
            where: { postId: deployment.postId, status: 'PUBLISHED' },
          })
          if (remainingPublished === 0) {
            try {
              assertBoPostTransition(post.status, 'PUBLISH_APPROVED')
              await prisma.boPost.update({
                where: { id: post.id },
                data: { status: 'PUBLISH_APPROVED' },
              })
            } catch {
              // 전환 불가 — 조용히 스킵, 로그만 기록
              console.warn(
                `[bo-jobs-complete] 포스트 ${post.id} PUBLISH_APPROVED 롤업 불가: status=${post.status}`
              )
            }
          }
        }
      }
    }

    return NextResponse.json({ ok: true })
  }

  // 실패 처리
  const nonRetryable = !isBoRetryableErrorCode(parsed.data.errorCode)
  const errorMessage = parsed.data.errorMessage ?? '알 수 없는 오류'
  const { updated, finalized } = await failBoJob(id, errorMessage, { nonRetryable })

  if (!updated) {
    // 이미 종료된 job 중복 보고 — 무시
    return NextResponse.json({ ok: true, noop: true })
  }

  // finalized(FAILED 확정) 일 때만 deployment FAILED 동기화
  // retryable 실패는 다음 재시도 중 PUBLISHING 유지 — UI 깜빡임 방지
  if (finalized && job.kind === 'PUBLISH' && job.targetId) {
    try {
      await prisma.boDeployment.updateMany({
        where: { id: job.targetId, status: 'PUBLISHING' },
        data: {
          status: 'FAILED',
          errorCode: parsed.data.errorCode ?? null,
          errorMessage: errorMessage.slice(0, 1000),
        },
      })
    } catch (err) {
      console.error('[bo-jobs-complete] BoDeployment 업데이트 실패:', err)
    }
  }

  // DELETE_POST 최종 실패 — 플랫폼에 글이 살아있으므로 FAILED 가 아닌 PUBLISHED 가 진실
  if (finalized && job.kind === 'DELETE_POST' && job.targetId) {
    try {
      await prisma.boDeployment.updateMany({
        where: { id: job.targetId, status: 'DELETING' },
        data: {
          status: 'PUBLISHED',
          errorCode: parsed.data.errorCode ?? null,
          errorMessage: errorMessage.slice(0, 1000),
        },
      })
    } catch (err) {
      console.error('[bo-jobs-complete] BoDeployment DELETE_POST 실패 복귀 오류:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
