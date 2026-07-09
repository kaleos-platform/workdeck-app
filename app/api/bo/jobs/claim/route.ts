import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, resolveWorkerAuth } from '@/lib/api-helpers'
import { claimNextBoJob, completeBoJob, reapStaleBoClaims } from '@/lib/bo/jobs'
import { getBoCredential } from '@/lib/bo/credentials'
import { prisma } from '@/lib/prisma'

const BO_JOB_KINDS = [
  'CRAWL_HOMEPAGE',
  'GENERATE_DRAFT',
  'GENERATE_VARIANT',
  'PUBLISH',
  'DELETE_POST',
] as const

const claimSchema = z.object({
  claimedBy: z.string().min(1),
  kinds: z.array(z.string()).optional(),
})

// POST /api/bo/jobs/claim — 워커 전용 job 점유 (x-worker-api-key 인증)
// 성공 시 job + PUBLISH 일 경우 deployment · variant · 채널 · 복호화된 자격증명 컨텍스트 반환
export async function POST(req: NextRequest) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = claimSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { claimedBy, kinds: rawKinds } = parsed.data
  const kinds = rawKinds
    ? (rawKinds.filter((k) =>
        (BO_JOB_KINDS as readonly string[]).includes(k)
      ) as (typeof BO_JOB_KINDS)[number][])
    : undefined

  // Stale CLAIMED 회복 — 매 폴링 사이클마다 실행, 대부분 0건
  const reaped = await reapStaleBoClaims().catch((err) => {
    console.warn('[bo-jobs-claim] reapStaleBoClaims 실패:', err)
    return 0
  })
  if (reaped > 0) {
    console.log(`[bo-jobs-claim] stale CLAIMED ${reaped}건 회복`)
  }

  const job = await claimNextBoJob({ workerId: claimedBy, kinds })
  if (!job) {
    return NextResponse.json({ job: null })
  }

  // 채널 자격증명 복호화 헬퍼 (COOKIE → OAUTH → API_KEY 순 우선)
  async function resolveCredential(channelId: string) {
    let credential: { kind: string; payload: Record<string, unknown> } | null = null
    for (const kind of ['COOKIE', 'OAUTH', 'API_KEY'] as const) {
      const cred = await getBoCredential(channelId, kind).catch(() => null)
      if (cred) {
        credential = { kind, payload: cred.payload }
        break
      }
    }
    return credential
  }

  // PUBLISH job: deployment + variant doc/title + 채널 platform/config + 자격증명 포함
  if (job.kind === 'PUBLISH' && typeof job.targetId === 'string') {
    const deployment = await prisma.boDeployment.findUnique({
      where: { id: job.targetId },
      include: {
        variant: {
          select: { id: true, title: true, doc: true, exportedMarkdown: true },
        },
        channel: {
          select: { id: true, platform: true, name: true, config: true },
        },
      },
    })

    if (deployment) {
      // 취소된 배포의 잔존 job 무해화 — cancel 과의 레이스 방어선
      // 무해화: 이미 처리 불필요해진 job 의 정상 종결 (COMPLETED)
      if (deployment.status !== 'PENDING' && deployment.status !== 'PUBLISHING') {
        await completeBoJob(job.id)
        return NextResponse.json({ job: null })
      }

      // PENDING → PUBLISHING 전환 (워커가 처리 시작함을 UI 에 알림)
      await prisma.boDeployment.updateMany({
        where: { id: deployment.id, status: 'PENDING' },
        data: { status: 'PUBLISHING' },
      })

      // updateMany 후 status 재조회로 claim-vs-cancel 레이스 창을 마감한다.
      // cancel 은 PENDING 만 취소 가능하므로 PUBLISHING 선점 이후엔 취소 불가.
      // updateMany count===0 만으로 무해화하면 안 됨 — reapStaleBoClaims 재claim 경로(deployment 이미 PUBLISHING)도 count 0 이므로 반드시 status 재조회 방식.
      const fresh = await prisma.boDeployment.findUnique({
        where: { id: deployment.id },
        select: { status: true },
      })
      if (fresh && fresh.status !== 'PENDING' && fresh.status !== 'PUBLISHING') {
        // 극히 좁은 레이스 창에서 cancel 이 PENDING 을 선점한 경우 — 무해화 처리
        await completeBoJob(job.id)
        return NextResponse.json({ job: null })
      }

      const credential = await resolveCredential(deployment.channelId)

      // context 필드 — worker contracts.ts BoPublishContext 와 1:1 대응
      return NextResponse.json({
        job,
        context: {
          deployment: {
            id: deployment.id,
          },
          variant: {
            title: deployment.variant?.title ?? '',
            doc: deployment.variant?.doc ?? null,
          },
          channel: {
            platform: deployment.channel?.platform ?? '',
            config: deployment.channel?.config ?? {},
          },
          credential,
        },
      })
    }
  }

  // DELETE_POST job: deployment platformUrl + 채널 platform/config + 자격증명 포함
  if (job.kind === 'DELETE_POST' && typeof job.targetId === 'string') {
    const deployment = await prisma.boDeployment.findUnique({
      where: { id: job.targetId },
      include: {
        channel: {
          select: { id: true, platform: true, config: true },
        },
      },
    })

    if (deployment) {
      // 삭제 대상이 아닌 경우 무해화
      if (deployment.status !== 'DELETING') {
        await completeBoJob(job.id)
        return NextResponse.json({ job: null })
      }

      const credential = await resolveCredential(deployment.channelId)

      // context 필드 — worker contracts.ts BoDeleteContext 와 1:1 대응
      return NextResponse.json({
        job,
        context: {
          deployment: {
            id: deployment.id,
            platformUrl: deployment.platformUrl,
          },
          channel: {
            platform: deployment.channel?.platform ?? '',
            config: deployment.channel?.config ?? {},
          },
          credential,
        },
      })
    }
  }

  return NextResponse.json({ job })
}
