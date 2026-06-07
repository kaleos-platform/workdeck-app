import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// 잡 1건 select (요약 필드 포함)
const JOB_SELECT = {
  id: true,
  workspaceId: true,
  days: true,
  trigger: true,
  status: true,
  claimedAt: true,
  claimedBy: true,
  completedAt: true,
  collected: true,
  converted: true,
  duplicateRows: true,
  outboundCount: true,
  revenueSum: true,
  orderSum: true,
  salesQtySum: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const

/**
 * GET /api/collection/backfill
 * - 기본: 현재 워크스페이스의 최신 백필 잡 1건 + hasVendorData (콜드스타트/폴링).
 * - ?list=true: 최근 백필 잡 이력 배열 반환 (수집 이력 패널).
 *
 * 응답(기본): { job: CoupangBackfillJob | null, hasVendorData: boolean }
 * 응답(list): { jobs: CoupangBackfillJob[], hasVendorData: boolean }
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const isList = request.nextUrl.searchParams.get('list') === 'true'

  // VENDOR_ITEM_METRICS 데이터 존재 여부 — 콜드스타트 팝업 조건
  const vendorCount = await prisma.inventoryRecord.count({
    where: { workspaceId: workspace.id, fileType: 'VENDOR_ITEM_METRICS' },
  })
  const hasVendorData = vendorCount > 0

  if (isList) {
    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 30, 100)
    const jobs = await prisma.coupangBackfillJob.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: JOB_SELECT,
    })
    return NextResponse.json({ jobs, hasVendorData })
  }

  // 최신 잡 1건 조회
  const job = await prisma.coupangBackfillJob.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
    select: JOB_SELECT,
  })

  return NextResponse.json({ job, hasVendorData })
}

/**
 * POST /api/collection/backfill
 * 백필 잡 생성. PENDING/RUNNING 잡이 이미 있으면 409 반환.
 *
 * body: { days: number }  (1~120)
 */
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const raw = body as Record<string, unknown>
  const days = typeof raw.days === 'number' ? raw.days : Number(raw.days)

  if (!Number.isInteger(days) || days < 1 || days > 120) {
    return errorResponse('days 는 1~120 사이의 정수여야 합니다', 400)
  }

  // 60분 이상 RUNNING 상태인 잡은 stale로 간주해 FAILED 처리.
  // 120일 백필은 ~30분 소요 가능하므로 collection/runs 의 10분과 달리 60분 임계값 사용.
  const staleThreshold = new Date(Date.now() - 60 * 60 * 1000)
  await prisma.coupangBackfillJob.updateMany({
    where: {
      workspaceId: workspace.id,
      status: 'RUNNING',
      claimedAt: { lt: staleThreshold },
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error: '타임아웃: 60분 이상 응답 없음 (워커 다운 추정)',
    },
  })

  // 중복 방지 — PENDING/RUNNING 잡이 이미 있으면 409
  const existing = await prisma.coupangBackfillJob.findFirst({
    where: {
      workspaceId: workspace.id,
      status: { in: ['PENDING', 'RUNNING'] },
    },
    select: { id: true, status: true },
  })
  if (existing) {
    return errorResponse('이미 진행 중인 백필 잡이 있습니다', 409, { existingJobId: existing.id })
  }

  const job = await prisma.coupangBackfillJob.create({
    data: {
      workspaceId: workspace.id,
      days,
    },
  })

  return NextResponse.json({ job }, { status: 201 })
}

/**
 * DELETE /api/collection/backfill
 * 현재 워크스페이스의 진행 중(PENDING|RUNNING) 백필 잡을 취소한다.
 * - PENDING: 워커가 아직 claim 안 함 → 즉시 CANCELLED (claim 차단).
 * - RUNNING: 워커가 날짜 루프 사이 상태를 확인해 조기 종료한다(워커 측 협조 취소).
 * 진행 중 잡이 없으면 404.
 */
export async function DELETE(_request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const active = await prisma.coupangBackfillJob.findFirst({
    where: {
      workspaceId: workspace.id,
      status: { in: ['PENDING', 'RUNNING'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  })

  if (!active) {
    return errorResponse('취소할 진행 중인 백필 잡이 없습니다', 404)
  }

  const updated = await prisma.coupangBackfillJob.update({
    where: { id: active.id },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
      error: '사용자 취소',
    },
    select: { id: true, status: true },
  })

  return NextResponse.json({ job: updated })
}
