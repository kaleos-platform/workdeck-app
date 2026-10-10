import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { authenticateWorker, workerHeartbeatServices } from '@/lib/worker-auth'

export const runtime = 'nodejs'

/**
 * POST /api/worker/heartbeat
 *
 * 워커 프로세스가 살아있음을 알리는 ping. 서비스별로 upsert하여
 * 마지막 핑 시각을 갱신한다. Vercel cron의 stale-check가 이 값을 보고
 * 워커 다운을 감지한다.
 *
 * Body: { service: string, metadata?: object }
 * Auth: x-worker-api-key 헤더 필수.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWorker(request.headers)
  if ('error' in auth) return auth.error

  const body = await request.json().catch(() => ({}))
  const service: string | undefined = body.service
  const metadata = body.metadata ?? null

  // ':' 는 Space 별 키 구분자 — 다른 Space 의 키(`svc:<spaceId>`)를 대신 갱신하지 못하게 막는다.
  if (!service || typeof service !== 'string' || service.includes(':')) {
    return errorResponse('service 필드가 필요합니다', 400)
  }

  const now = new Date()
  const [globalService, ...spaceServices] = workerHeartbeatServices(
    service,
    auth.scope.kind === 'space' ? auth.scope.spaceId : undefined
  )
  const row = await prisma.workerHeartbeat.upsert({
    where: { service: globalService },
    create: { service: globalService, lastPingAt: now, metadata },
    update: { lastPingAt: now, metadata },
  })
  for (const s of spaceServices) {
    await prisma.workerHeartbeat.upsert({
      where: { service: s },
      create: { service: s, lastPingAt: now, metadata },
      update: { lastPingAt: now, metadata },
    })
  }

  return NextResponse.json({
    service: row.service,
    lastPingAt: row.lastPingAt.toISOString(),
  })
}
