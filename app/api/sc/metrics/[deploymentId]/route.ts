// 수동 성과 지표 입력 + 조회.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { upsertDeploymentMetric, getDeploymentMetricsTotal } from '@/lib/sc/metrics'

type Params = { params: Promise<{ deploymentId: string }> }

const bodySchema = z.object({
  date: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  source: z.enum(['MANUAL', 'API', 'BROWSER', 'INTERNAL']).default('MANUAL'),
  impressions: z.number().int().nonnegative().optional().nullable(),
  views: z.number().int().nonnegative().optional().nullable(),
  likes: z.number().int().nonnegative().optional().nullable(),
  comments: z.number().int().nonnegative().optional().nullable(),
  shares: z.number().int().nonnegative().optional().nullable(),
  externalClicks: z.number().int().nonnegative().optional().nullable(),
})

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { deploymentId } = await params
  const deployment = await prisma.contentDeployment.findFirst({
    where: { id: deploymentId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!deployment) return errorResponse('배포를 찾을 수 없습니다', 404)

  const result = await getDeploymentMetricsTotal(deploymentId)
  return NextResponse.json(result)
}

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { deploymentId } = await params
  const deployment = await prisma.contentDeployment.findFirst({
    where: { id: deploymentId, spaceId: resolved.space.id },
    select: { id: true },
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

  const metric = await upsertDeploymentMetric({
    spaceId: resolved.space.id,
    deploymentId,
    date: new Date(parsed.data.date),
    source: parsed.data.source,
    numbers: {
      impressions: parsed.data.impressions,
      views: parsed.data.views,
      likes: parsed.data.likes,
      comments: parsed.data.comments,
      shares: parsed.data.shares,
      externalClicks: parsed.data.externalClicks,
    },
  })
  return NextResponse.json({ metric }, { status: 201 })
}
