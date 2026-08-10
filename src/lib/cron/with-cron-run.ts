import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/** detail JSON 상한 — 초과하면 절단 마커로 대체 (거대 결과가 테이블을 부풀리지 않게). */
const MAX_DETAIL_BYTES = 8_192

type CronHandler = (request: NextRequest) => Promise<Record<string, unknown>>

/**
 * Vercel cron 라우트 공통 래퍼.
 *
 * - `Authorization: Bearer ${CRON_SECRET}` 검증 (5개 라우트에 복붙돼 있던 로직)
 * - 실행 이력을 `CronRun`에 기록 — 스케줄러가 실제로 호출했는지 확인하는 유일한 근거.
 *   런타임 로그는 1일만 남고 REST API로 못 읽는다.
 *
 * 이력 기록 실패가 cron 자체를 죽이면 안 되므로 `recordRun`은 절대 throw하지 않는다.
 */
export function withCronRun(path: string, handler: CronHandler) {
  return async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 401 })
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const startedAt = new Date()
    try {
      const detail = await handler(request)
      await recordRun({ path, startedAt, ok: true, detail })
      return NextResponse.json({ ranAt: startedAt.toISOString(), ...detail })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron${path}] 실패:`, err)
      await recordRun({ path, startedAt, ok: false, error: message })
      return NextResponse.json(
        { ranAt: startedAt.toISOString(), error: message },
        { status: 500 }
      )
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

function truncateDetail(detail?: Record<string, unknown>) {
  if (!detail) return undefined
  const json = JSON.stringify(detail)
  if (json.length <= MAX_DETAIL_BYTES) return detail
  return { truncated: true, bytes: json.length }
}
