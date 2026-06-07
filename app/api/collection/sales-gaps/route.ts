import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

export const runtime = 'nodejs'

const DEFAULT_DAYS = 14
const MAX_DAYS = 60

/**
 * GET /api/collection/sales-gaps?workspaceId=<id>&days=14
 * 워커 전용 — 최근 N일(어제까지) KST 일자 중 VENDOR_ITEM_METRICS 스냅샷이
 * 없는 누락 일자를 반환한다. cron self-heal 이 누락분만 재수집하는 데 사용.
 *
 * 응답: { missingDates: string[] }  // "YYYY-MM-DD" (KST), 오래된 순
 *
 * 누락 = 해당 KST 일자 [00:00, 24:00) 범위에 VENDOR 레코드 0건.
 * 오늘(아직 미수집)·어제(cron 이 방금 수집)는 호출자가 필요 시 제외한다.
 */
export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const sp = request.nextUrl.searchParams
  const daysRaw = Number(sp.get('days')) || DEFAULT_DAYS
  const days = Math.min(Math.max(1, Math.floor(daysRaw)), MAX_DAYS)

  // workspace 해석 — 명시 우선, 없으면 첫 활성 credential.
  let workspaceId = sp.get('workspaceId') ?? ''
  if (!workspaceId) {
    const cred = await prisma.coupangCredential.findFirst({
      where: { isActive: true },
      select: { workspaceId: true },
    })
    if (!cred) return errorResponse('활성 워크스페이스가 없습니다', 404)
    workspaceId = cred.workspaceId
  }

  // 최근 days 일의 KST 일자 키 목록 (어제 ~ days일 전). 오늘은 제외(미수집).
  const nowKstMs = Date.now() + 9 * 3600 * 1000
  const todayKstKey = new Date(nowKstMs).toISOString().slice(0, 10)
  const todayKstStart = new Date(`${todayKstKey}T00:00:00+09:00`)

  const wantKeys: string[] = []
  for (let i = 1; i <= days; i++) {
    const d = new Date(todayKstStart.getTime() - i * 24 * 3600 * 1000)
    wantKeys.push(new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10))
  }

  // 조회 범위: 가장 오래된 want 일자 시작 ~ 오늘 시작
  const rangeStart = new Date(`${wantKeys[wantKeys.length - 1]}T00:00:00+09:00`)
  const records = await prisma.inventoryRecord.findMany({
    where: {
      workspaceId,
      fileType: 'VENDOR_ITEM_METRICS',
      snapshotDate: { gte: rangeStart, lt: todayKstStart },
    },
    select: { snapshotDate: true },
  })

  // 존재 일자 KST 키 Set
  const haveKeys = new Set<string>()
  for (const r of records) {
    const k = new Date(r.snapshotDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    haveKeys.add(k)
  }

  // 누락 = want - have. 오래된 순 정렬.
  const missingDates = wantKeys.filter((k) => !haveKeys.has(k)).sort()

  return NextResponse.json({ missingDates })
}
