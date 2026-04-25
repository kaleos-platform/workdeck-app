// 워커 전용 metrics upsert. x-worker-api-key 인증.
// 단일 deploymentId 에 대해 여러 일자의 CollectedMetric 을 한 번에 upsert.
// CollectorScheduler 와 sc-runner 가 호출.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, resolveWorkerAuth } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { upsertDeploymentMetric } from '@/lib/sc/metrics'

type Params = { params: Promise<{ deploymentId: string }> }

const metricSchema = z.object({
  // 둘 다 허용 (UTC ISO 또는 YYYY-MM-DD).
  date: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  source: z.enum(['MANUAL', 'API', 'BROWSER', 'INTERNAL']).default('BROWSER'),
  impressions: z.number().int().nonnegative().optional().nullable(),
  views: z.number().int().nonnegative().optional().nullable(),
  likes: z.number().int().nonnegative().optional().nullable(),
  comments: z.number().int().nonnegative().optional().nullable(),
  shares: z.number().int().nonnegative().optional().nullable(),
  externalClicks: z.number().int().nonnegative().optional().nullable(),
})

const bodySchema = z.object({
  metrics: z.array(metricSchema).min(1).max(60),
})

export async function POST(req: NextRequest, { params }: Params) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  const { deploymentId } = await params
  const deployment = await prisma.contentDeployment.findUnique({
    where: { id: deploymentId },
    select: { id: true, spaceId: true },
  })
  if (!deployment) return errorResponse('배포를 찾을 수 없습니다', 404)

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

  // 일자 단위로 순차 upsert. 일자 수가 작으므로 트랜잭션 없이 충분.
  const upserted = []
  for (const m of parsed.data.metrics) {
    const row = await upsertDeploymentMetric({
      spaceId: deployment.spaceId,
      deploymentId,
      date: new Date(m.date),
      source: m.source,
      numbers: {
        impressions: m.impressions,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        externalClicks: m.externalClicks,
      },
    })
    upserted.push(row.id)
  }

  return NextResponse.json({ upserted: upserted.length, ids: upserted }, { status: 201 })
}
