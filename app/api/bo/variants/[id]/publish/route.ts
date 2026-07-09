import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { enqueueBoJob } from '@/lib/bo/jobs'

type Params = { params: Promise<{ id: string }> }

const publishBodySchema = z.object({
  scheduledAt: z.string().datetime().optional(),
})

// POST /api/bo/variants/[id]/publish — 변형 발행 트리거
// READY|EDITED 변형 + BROWSER 모드 채널 + 자격증명 존재 검증 후
// BoDeployment(PENDING) + BoJob(PUBLISH) 생성
// body { scheduledAt?: string } (ISO) — 없으면 즉시 발행 (기존 호환)
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id: variantId } = await params

  // body 파싱 — body 없는 기존 호출도 허용 (빈 객체로 처리)
  let rawBody: unknown = {}
  try {
    rawBody = await req.json()
  } catch {
    // body 없음 = 즉시 발행
  }

  const parsed = publishBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  let scheduledDate: Date | undefined
  if (parsed.data.scheduledAt) {
    scheduledDate = new Date(parsed.data.scheduledAt)
    const now = new Date()
    const minTime = new Date(now.getTime() + 2 * 60 * 1000) // now + 2분
    const maxTime = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) // now + 90일
    if (scheduledDate < minTime || scheduledDate > maxTime) {
      return errorResponse('예약 시각은 지금으로부터 2분 이후 ~ 90일 이내여야 합니다', 422)
    }
  }

  // 변형 조회 (채널 publisherMode 포함)
  const variant = await prisma.boPostVariant.findFirst({
    where: { id: variantId, spaceId: resolved.space.id },
    select: {
      id: true,
      postId: true,
      channelId: true,
      status: true,
      channel: {
        select: { id: true, publisherMode: true },
      },
    },
  })

  if (!variant) return errorResponse('변형을 찾을 수 없습니다', 404)

  // READY 또는 EDITED 상태만 발행 가능
  if (variant.status !== 'READY' && variant.status !== 'EDITED') {
    return errorResponse('READY 또는 EDITED 상태의 변형만 발행할 수 있습니다', 422)
  }

  // BROWSER 모드 채널만 자동 발행 가능
  if (variant.channel.publisherMode !== 'BROWSER') {
    return errorResponse('BROWSER 모드 채널에서만 자동 발행이 가능합니다', 422)
  }

  // 자격증명 존재 확인
  const credCount = await prisma.boChannelCredential.count({
    where: { channelId: variant.channelId },
  })
  if (credCount === 0) {
    return errorResponse(
      '채널에 등록된 자격증명이 없습니다. 채널 설정에서 자격증명을 등록해 주세요.',
      422
    )
  }

  // BoDeployment(PENDING) 생성
  const deployment = await prisma.boDeployment.create({
    data: {
      spaceId: resolved.space.id,
      postId: variant.postId,
      variantId: variant.id,
      channelId: variant.channelId,
      status: 'PENDING',
      scheduledAt: scheduledDate ?? null,
    },
  })

  // 발행 작업 큐에 등록 (scheduledAt 존재 시 예약 시각에 실행)
  await enqueueBoJob({
    spaceId: resolved.space.id,
    kind: 'PUBLISH',
    targetId: deployment.id,
    payload: { deploymentId: deployment.id },
    scheduledAt: scheduledDate,
  })

  return NextResponse.json(
    {
      deployment: {
        id: deployment.id,
        status: deployment.status,
        scheduledAt: deployment.scheduledAt ? deployment.scheduledAt.toISOString() : null,
        createdAt: deployment.createdAt.toISOString(),
      },
    },
    { status: 201 }
  )
}
