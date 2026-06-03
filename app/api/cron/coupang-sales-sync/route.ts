import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveCronOrWorkerAuth } from '@/lib/api-helpers'
import { runCoupangSalesSyncForDates } from '@/lib/inv/coupang-sales-to-movement'

export const runtime = 'nodejs'
export const maxDuration = 300

const WORKER_SERVICE = 'coupang-sales-sync'

/**
 * GET /api/cron/coupang-sales-sync — Vercel cron 호출 전용.
 *
 * 워커가 수집한 어제(KST) 판매분석(VENDOR_ITEM_METRICS) 로켓그로스 판매량을
 * OUTBOUND 이동으로 변환한다. 발주예측이 로켓그로스 수요를 읽을 수 있게 한다.
 *
 * - 판매자배송은 제외(이미 DelBatch→OUTBOUND, 무중복).
 * - referenceId 멱등 — 재실행/정정 안전.
 * - **stock-neutral**: 재고를 차감하지 않는다. dated OUTBOUND 는 발주예측 history 전용이고,
 *   재고 truth 는 coupang-inventory-sync(inventory_health 대조, 절대값 set)가 책임진다.
 *
 * 백필 모드(콜드스타트): ?from=YYYY-MM-DD&to=YYYY-MM-DD 지정 시 해당 KST 일자 범위를 변환.
 *
 * 인증: 워커(x-worker-api-key, 1차 — 수집 후 체이닝) 또는 Vercel cron(Bearer CRON_SECRET, 백스톱).
 */
export async function GET(request: NextRequest) {
  const auth = resolveCronOrWorkerAuth(request)
  if ('error' in auth) return auth.error

  const { searchParams } = request.nextUrl
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')

  let dates: Date[]
  let mode: string

  if (fromStr && toStr) {
    // 백필 range
    const range = buildKstDateRange(fromStr, toStr)
    if (!range) {
      return NextResponse.json(
        { error: 'from/to 가 유효하지 않습니다 (YYYY-MM-DD)' },
        { status: 400 }
      )
    }
    if (range.length > 120) {
      return NextResponse.json({ error: '범위는 최대 120일입니다' }, { status: 400 })
    }
    dates = range
    mode = 'backfill'
  } else {
    // 일일 — 어제 1일
    dates = [kstYesterday()]
    mode = 'daily'
  }

  const spaces = await runCoupangSalesSyncForDates(dates)

  await prisma.workerHeartbeat
    .upsert({
      where: { service: WORKER_SERVICE },
      create: { service: WORKER_SERVICE, lastPingAt: new Date() },
      update: { lastPingAt: new Date() },
    })
    .catch(() => {})

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    mode,
    dateCount: dates.length,
    spaces,
  })
}

/** 어제(KST) 자정 시각(UTC). */
function kstYesterday(): Date {
  const nowKstMs = Date.now() + 9 * 3600 * 1000
  const todayKey = new Date(nowKstMs).toISOString().slice(0, 10)
  const todayKstMidnight = new Date(`${todayKey}T00:00:00+09:00`)
  return new Date(todayKstMidnight.getTime() - 24 * 3600 * 1000)
}

/** [fromKst, toKst] 포함 범위의 KST 자정 Date 배열. 유효하지 않으면 null. */
function buildKstDateRange(fromStr: string, toStr: string): Date[] | null {
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(fromStr) || !re.test(toStr)) return null
  const from = new Date(`${fromStr}T00:00:00+09:00`)
  const to = new Date(`${toStr}T00:00:00+09:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null
  const out: Date[] = []
  for (let t = from.getTime(); t <= to.getTime(); t += 24 * 3600 * 1000) {
    out.push(new Date(t))
  }
  return out
}
