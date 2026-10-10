import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateWorker } from '@/lib/worker-auth'
import { timingSafeEqualString } from '@/lib/crypto/timing-safe'

/** detail JSON 상한 — 초과하면 절단 마커로 대체 (거대 결과가 테이블을 부풀리지 않게). */
const MAX_DETAIL_BYTES = 8_192

/** 스윕 범위 — spaceId 가 있으면 그 Space 만, 없으면 전체 Space. */
export type SweepScope = { spaceId?: string }

type CronHandler = (request: NextRequest, scope: SweepScope) => Promise<Record<string, unknown>>

/**
 * 체이닝 cron 의 스윕 범위.
 *  - Authorization: Bearer ${CRON_SECRET} → 전체 Space(서버 전용. 워커에는 이 값을 주지 않는다)
 *  - 워커 Space 토큰 → 그 Space 만(재고 차감·응답 집계 모두)
 *  - 레거시 단일 키(전환 기간) → 원래 권한대로 전체. Task 7 Step 8-7 에서 분기와 함께 삭제한다.
 */
export async function resolveSweepScope(
  request: NextRequest
): Promise<{ scope: SweepScope } | { error: NextResponse }> {
  const cronSecret = process.env.CRON_SECRET
  const bearer = request.headers.get('authorization')
  if (cronSecret && bearer && timingSafeEqualString(bearer, `Bearer ${cronSecret}`)) {
    return { scope: {} }
  }
  const auth = await authenticateWorker(request.headers)
  if ('error' in auth) return { error: auth.error }
  return { scope: auth.scope.kind === 'space' ? { spaceId: auth.scope.spaceId } : {} }
}

/**
 * 인증 방식.
 * - `cron-secret`: Vercel 스케줄러 (`Authorization: Bearer ${CRON_SECRET}`)
 * - `worker`: 맥미니 워커가 수집 직후 체이닝 호출 (`x-worker-api-key`).
 *   vercel.json crons 에 등록하지 않는 라우트 — 수집에 성공했을 때만 돌아야 하기 때문.
 */
type CronAuth = 'cron-secret' | 'worker'

/**
 * cron 라우트 공통 래퍼.
 *
 * - 인증 검증 (라우트마다 복붙돼 있던 로직)
 * - 실행 이력을 `CronRun`에 기록 — 스케줄러가 실제로 호출했는지 확인하는 유일한 근거.
 *   런타임 로그는 1일만 남고 REST API로 못 읽는다.
 *   워커 체이닝 cron 도 같은 사각지대에 있다(워커가 안 불렀는지, 불렀는데 실패했는지 구별 불가).
 *
 * 이력 기록 실패가 cron 자체를 죽이면 안 되므로 `recordRun`은 절대 throw하지 않는다.
 */
export function withCronRun(path: string, handler: CronHandler, auth: CronAuth = 'cron-secret') {
  return async function GET(request: NextRequest) {
    let scope: SweepScope = {}
    if (auth === 'worker') {
      const sweep = await resolveSweepScope(request)
      if ('error' in sweep) return sweep.error
      scope = sweep.scope
    } else {
      const cronSecret = process.env.CRON_SECRET
      if (!cronSecret) {
        return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 401 })
      }
      if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    }

    const startedAt = new Date()
    try {
      const detail = await handler(request, scope)
      await recordRun({ path, startedAt, ok: true, detail })
      return NextResponse.json({ ranAt: startedAt.toISOString(), ...detail })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron${path}] 실패:`, err)
      await recordRun({ path, startedAt, ok: false, error: message })
      return NextResponse.json({ ranAt: startedAt.toISOString(), error: message }, { status: 500 })
    }
  }
}

async function recordRun(args: {
  path: string
  startedAt: Date
  ok: boolean
  detail?: Record<string, unknown>
  error?: string
}) {
  const finishedAt = new Date()
  try {
    await prisma.cronRun.create({
      data: {
        path: args.path,
        startedAt: args.startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - args.startedAt.getTime(),
        ok: args.ok,
        detail: truncateDetail(args.detail),
        error: args.error?.slice(0, 1000) ?? null,
      },
    })
  } catch (err) {
    console.error(`[cron${args.path}] 실행 이력 기록 실패:`, err)
  }
}

function truncateDetail(detail?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  if (!detail) return undefined
  const json = JSON.stringify(detail)
  if (json.length > MAX_DETAIL_BYTES) return { truncated: true, bytes: json.length }
  // Record<string, unknown>은 Prisma의 InputJsonValue와 구조적으로 호환되지 않는다
  // (unknown이 JSON 값으로 좁혀지지 않음). 직렬화 가능함은 JSON.stringify로 이미 확인됨.
  return JSON.parse(json) as Prisma.InputJsonValue
}
