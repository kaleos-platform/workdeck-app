// Worker 전용 엔드포인트 — x-worker-api-key 인증(Space 토큰은 자기 Space 의 job 만).
// GET  ?kinds=PUBLISH,COLLECT_METRIC&limit=5&workerId=sc-worker-01 → claim 결과
// POST                                                            → enqueue (관리용)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { assertWorkerOwns, authenticateWorker } from '@/lib/worker-auth'
import { claimJobs, enqueueJob, reapStaleClaims } from '@/lib/sc/jobs'
import { prisma } from '@/lib/prisma'
import { readChannelCredential } from '@/lib/sc/credentials'
import { getAppOrigin } from '@/lib/domain'

const KINDS = ['PUBLISH', 'COLLECT_METRIC', 'INSIGHT_SWEEP'] as const

export async function GET(req: NextRequest) {
  const auth = await authenticateWorker(req.headers)
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

  // Stale CLAIMED 회복 — 워커가 보고 없이 죽은 job 이 영영 잡히지 않는 것을 방지.
  // 매 polling 사이클마다 실행되지만 updateMany 는 indexed where 로 빠르고 대부분 0 row.
  const reaped = await reapStaleClaims().catch((err) => {
    console.warn('[sc-jobs-worker] reapStaleClaims 실패:', err)
    return 0
  })
  if (reaped > 0) {
    console.log(`[sc-jobs-worker] stale CLAIMED ${reaped}건 회복`)
  }

  const jobs = await claimJobs({
    workerId,
    kinds,
    limit,
    spaceId: auth.scope.kind === 'space' ? auth.scope.spaceId : undefined,
  })

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
      // targetId 에는 FK 가 없다 — 배포·콘텐츠·채널이 모두 job 의 Space 소속일 때만 컨텍스트(자격증명 포함)를 붙인다.
      const deployment = await prisma.contentDeployment.findFirst({
        where: {
          id: job.targetId,
          spaceId: job.spaceId,
          content: { spaceId: job.spaceId },
          channel: { spaceId: job.spaceId },
        },
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
  const auth = await authenticateWorker(req.headers)
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
  const denied = assertWorkerOwns(auth.scope, { spaceId: parsed.data.spaceId })
  if (denied) return denied
  // 다른 Space 의 배포를 targetId 로 넣지 못하게 한다(존재 여부는 숨긴다).
  if (
    parsed.data.targetId &&
    (parsed.data.kind === 'PUBLISH' || parsed.data.kind === 'COLLECT_METRIC')
  ) {
    const target = await prisma.contentDeployment.findFirst({
      where: { id: parsed.data.targetId, spaceId: parsed.data.spaceId },
      select: { id: true },
    })
    if (!target) return errorResponse('대상 배포를 찾을 수 없습니다', 404)
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
