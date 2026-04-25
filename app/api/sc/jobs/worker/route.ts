// Worker 전용 엔드포인트 — x-worker-api-key 인증.
// GET  ?kinds=PUBLISH,COLLECT_METRIC&limit=5&workerId=sc-worker-01 → claim 결과
// POST                                                            → enqueue (관리용)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, resolveWorkerAuth } from '@/lib/api-helpers'
import { claimJobs, enqueueJob } from '@/lib/sc/jobs'
import { prisma } from '@/lib/prisma'
import { readChannelCredential } from '@/lib/sc/credentials'
import { getAppOrigin } from '@/lib/domain'

const KINDS = ['PUBLISH', 'COLLECT_METRIC', 'INSIGHT_SWEEP'] as const

export async function GET(req: NextRequest) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  const url = new URL(req.url)
  const workerId = url.searchParams.get('workerId') ?? 'anonymous-worker'
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 5), 25)
  const kindsParam = url.searchParams.get('kinds')
  const kinds = kindsParam
    ? (kindsParam
        .split(',')
        .filter((k) => (KINDS as readonly string[]).includes(k)) as (typeof KINDS)[number][])
    : undefined

  const jobs = await claimJobs({ workerId, kinds, limit })

  // 각 job 에 대해 필요한 배포·채널·자격증명 컨텍스트를 함께 돌려준다.
  // 워커가 개별 콜 없이 바로 시작할 수 있도록.
  // PublishContext / CollectContext 의 평탄화 — runner 가 c.deployment / c.assets / c.deploymentUrl 로 직접 사용.
  const origin = getAppOrigin()
  const expanded = await Promise.all(
    jobs.map(async (job) => {
      const usesDeploymentContext = job.kind === 'PUBLISH' || job.kind === 'COLLECT_METRIC'
      if (!usesDeploymentContext || typeof job.targetId !== 'string') {
        return { job }
      }
      const deployment = await prisma.contentDeployment.findUnique({
        where: { id: job.targetId },
        include: {
          content: { include: { assets: true } },
          channel: true,
        },
      })
      if (!deployment) return { job }

      const credential = await readChannelCredential(deployment.channelId, 'COOKIE').catch(
        () => null
      )
      const assets = deployment.content.assets.map((a) => ({
        slotKey: a.slotKey,
        url: a.url,
        alt: a.alt,
      }))
      const deploymentUrl = `${origin}/c/${deployment.shortSlug}`

      return { job, deployment, credential, assets, deploymentUrl }
    })
  )

  return NextResponse.json({ jobs: expanded })
}

const enqueueSchema = z.object({
  spaceId: z.string().cuid(),
  kind: z.enum(KINDS),
  targetId: z.string().optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = enqueueSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const job = await enqueueJob({
    spaceId: parsed.data.spaceId,
    kind: parsed.data.kind,
    targetId: parsed.data.targetId ?? null,
    payload: parsed.data.payload,
    scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
  })
  return NextResponse.json({ job }, { status: 201 })
}
