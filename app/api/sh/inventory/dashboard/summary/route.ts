import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// KST(UTC+9) 기준 오늘 하루(Date)를 UTC 범위로 구한다
function kstTodayRange(): { start: Date; end: Date } {
  const now = new Date()
  // KST 자정 = UTC 전날 15:00
  const kstOffsetMs = 9 * 60 * 60 * 1000
  const kstNow = new Date(now.getTime() + kstOffsetMs)
  const y = kstNow.getUTCFullYear()
  const m = kstNow.getUTCMonth()
  const d = kstNow.getUTCDate()
  const startKst = Date.UTC(y, m, d, 0, 0, 0)
  const endKst = Date.UTC(y, m, d, 23, 59, 59, 999)
  return {
    start: new Date(startKst - kstOffsetMs),
    end: new Date(endKst - kstOffsetMs),
  }
}

function parseKstDate(ymd: string | null, endOfDay = false): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [y, m, d] = ymd.split('-').map(Number)
  const kstOffsetMs = 9 * 60 * 60 * 1000
  const utc = endOfDay ? Date.UTC(y, m - 1, d, 23, 59, 59, 999) : Date.UTC(y, m - 1, d, 0, 0, 0)
  return new Date(utc - kstOffsetMs)
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl
  const locationId = searchParams.get('locationId') || undefined
  const channelId = searchParams.get('channelId') || undefined
  const from = parseKstDate(searchParams.get('from'))
  const to = parseKstDate(searchParams.get('to'), true)

  // 재고 관련 where (locationId만 영향, channel은 영향 없음)
  const stockWhere: { spaceId: string; locationId?: string } = { spaceId }
  if (locationId) stockWhere.locationId = locationId

  // 움직임 where base
  const movementChannelFilter: { channelId?: string } | null = channelId ? { channelId } : null

  type MovementWhere = {
    spaceId: string
    locationId?: string
    type?: 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT'
    channelId?: string
    movementDate?: { gte?: Date; lte?: Date }
  }

  const baseMovementWhere: MovementWhere = { spaceId }
  if (locationId) baseMovementWhere.locationId = locationId
  if (movementChannelFilter?.channelId)
    baseMovementWhere.channelId = movementChannelFilter.channelId
  if (from || to) {
    baseMovementWhere.movementDate = {}
    if (from) baseMovementWhere.movementDate.gte = from
    if (to) baseMovementWhere.movementDate.lte = to
  }

  // 전체 재고
  const stockAgg = await prisma.invStockLevel.aggregate({
    where: stockWhere,
    _sum: { quantity: true },
  })
  const totalStockUnits = stockAgg._sum.quantity ?? 0

  // 마이너스 재고 SKU 수
  const negativeStockSkus = await prisma.invStockLevel.count({
    where: { ...stockWhere, quantity: { lt: 0 } },
  })

  // 전체 SKU 수: 재고 > 0인 옵션 + 움직임 있는 옵션(중복 제거)
  const [stockedOptions, movedOptions] = await Promise.all([
    prisma.invStockLevel.findMany({
      where: { ...stockWhere, quantity: { gt: 0 } },
      select: { optionId: true },
      distinct: ['optionId'],
    }),
    prisma.invMovement.findMany({
      where: { spaceId, ...(locationId ? { locationId } : {}) },
      select: { optionId: true },
      distinct: ['optionId'],
    }),
  ])
  const skuSet = new Set<string>()
  stockedOptions.forEach((s) => skuSet.add(s.optionId))
  movedOptions.forEach((s) => skuSet.add(s.optionId))
  const totalSkus = skuSet.size

  // 오늘 입고/출고 (KST 기준)
  const { start: todayStart, end: todayEnd } = kstTodayRange()
  const todayWhereBase: MovementWhere = {
    spaceId,
    movementDate: { gte: todayStart, lte: todayEnd },
  }
  if (locationId) todayWhereBase.locationId = locationId

  const [todayInboundAgg, todayOutboundAgg] = await Promise.all([
    prisma.invMovement.aggregate({
      where: { ...todayWhereBase, type: 'INBOUND' },
      _sum: { quantity: true },
    }),
    prisma.invMovement.aggregate({
      where: {
        ...todayWhereBase,
        type: 'OUTBOUND',
        ...(baseMovementWhere.channelId ? { channelId: baseMovementWhere.channelId } : {}),
      },
      _sum: { quantity: true },
    }),
  ])
  const todayInbound = Math.abs(todayInboundAgg._sum.quantity ?? 0)
  const todayOutbound = Math.abs(todayOutboundAgg._sum.quantity ?? 0)

  // 위치별 재고
  const byLocation = await prisma.invStockLevel.groupBy({
    by: ['locationId'],
    where: stockWhere,
    _sum: { quantity: true },
  })
  const locationIds = byLocation.map((b) => b.locationId)
  const locations = locationIds.length
    ? await prisma.invStorageLocation.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true },
      })
    : []
  const locationNameById = new Map(locations.map((l) => [l.id, l.name]))
  const movementsByLocation = byLocation
    .map((b) => ({
      locationId: b.locationId,
      locationName: locationNameById.get(b.locationId) ?? '(알 수 없음)',
      stockUnits: b._sum.quantity ?? 0,
    }))
    .sort((a, b) => b.stockUnits - a.stockUnits)

  return NextResponse.json({
    totalSkus,
    totalStockUnits,
    negativeStockSkus,
    todayInbound,
    todayOutbound,
    movementsByLocation,
  })
}
