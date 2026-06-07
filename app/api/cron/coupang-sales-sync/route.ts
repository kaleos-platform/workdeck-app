import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth } from '@/lib/api-helpers'
import { runCoupangSalesSyncForDates } from '@/lib/inv/coupang-sales-to-movement'

export const runtime = 'nodejs'
export const maxDuration = 300

const WORKER_SERVICE = 'coupang-sales-sync'

/**
 * GET /api/cron/coupang-sales-sync — 워커 체이닝 호출 전용.
 *
 * 워커가 수집한 어제(KST) 판매분석(VENDOR_ITEM_METRICS) 로켓그로스 판매량을
 * OUTBOUND 이동으로 변환한다. 발주예측이 로켓그로스 수요를 읽을 수 있게 한다.
 *
 * - 판매자배송은 제외(이미 DelBatch→OUTBOUND, 무중복).
 * - referenceId 멱등 — 재실행/정정 안전(정정 시 delta 재고 보정).
 * - **재고 차감**: OUTBOUND 가 재고를 차감한다(perpetual ledger). 재고 truth =
 *   OUTBOUND 차감 + 사용자 수동 대조 보정. (자동 대조 cron 은 제거됨.)
 *
 * 백필 모드(콜드스타트): ?from=YYYY-MM-DD&to=YYYY-MM-DD 지정 시 해당 KST 일자 범위를 변환.
 *
 * 인증: 워커(x-worker-api-key) 전용 — 수집 후 워커가 직접 체이닝 호출.
 */
export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const { searchParams } = request.nextUrl
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  // 일일 수집 트리거 구분 (이력 잡 라벨) — manual(지금 수집) | scheduled(cron). 기본 scheduled.
  const trigger = searchParams.get('trigger') === 'manual' ? 'manual' : 'scheduled'

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

  // 전 Space 누적 집계 — 워커(Slack·이력)가 단일 숫자로 소비.
  const totals = spaces.reduce(
    (acc, s) => ({
      converted: acc.converted + (s.created ?? 0) + (s.updated ?? 0),
      revenue: acc.revenue + (s.revenue ?? 0),
      orderCount: acc.orderCount + (s.orderCount ?? 0),
      salesQty: acc.salesQty + (s.salesQty ?? 0),
    }),
    { converted: 0, revenue: 0, orderCount: 0, salesQty: 0 }
  )

  // daily 모드 — 워크스페이스별 수집 이력 잡 1건 기록 (manual/scheduled).
  // seller-ops 수집 이력 패널이 백필 잡과 함께 일일 수집 행도 표시할 수 있게 한다.
  // 백필 모드는 워커가 잡을 직접 관리하므로 여기서 기록하지 않는다.
  // 멱등: 같은 워크스페이스·trigger 의 "오늘(KST) 생성" 일일 잡이 이미 있으면 갱신
  //       (manual 재실행/cron 재시도로 행이 중복 누적되지 않게).
  if (mode === 'daily') {
    const nowKst = new Date(Date.now() + 9 * 3600 * 1000)
    const todayKstStart = new Date(`${nowKst.toISOString().slice(0, 10)}T00:00:00+09:00`)
    for (const s of spaces) {
      if (s.status !== 'ok' || !s.workspaceId) continue
      const outbound = (s.created ?? 0) + (s.updated ?? 0)
      try {
        const existing = await prisma.coupangBackfillJob.findFirst({
          where: {
            workspaceId: s.workspaceId,
            days: 1,
            trigger,
            createdAt: { gte: todayKstStart },
          },
          select: { id: true },
        })
        const data = {
          status: 'DONE' as const,
          claimedAt: new Date(),
          completedAt: new Date(),
          collected: 1,
          converted: outbound,
          outboundCount: outbound,
          revenueSum: s.revenue ?? 0,
          orderSum: s.orderCount ?? 0,
          salesQtySum: s.salesQty ?? 0,
        }
        if (existing) {
          await prisma.coupangBackfillJob.update({ where: { id: existing.id }, data })
        } else {
          await prisma.coupangBackfillJob.create({
            data: { workspaceId: s.workspaceId, days: 1, trigger, ...data },
          })
        }
      } catch (err) {
        console.error(`[sales-sync] 이력 잡 기록 실패 (space ${s.spaceId}):`, err)
      }
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    mode,
    dateCount: dates.length,
    spaces,
    totals,
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
