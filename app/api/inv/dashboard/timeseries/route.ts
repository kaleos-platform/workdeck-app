import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Granularity = 'day' | 'week' | 'month'
type MoveType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function parseKstDate(ymd: string | null, endOfDay = false): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [y, m, d] = ymd.split('-').map(Number)
  const utc = endOfDay
    ? Date.UTC(y, m - 1, d, 23, 59, 59, 999)
    : Date.UTC(y, m - 1, d, 0, 0, 0)
  return new Date(utc - KST_OFFSET_MS)
}

function toKstYmd(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().split('T')[0]
}

function bucketKey(date: Date, granularity: Granularity): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS)
  const y = kst.getUTCFullYear()
  const m = kst.getUTCMonth()
  const d = kst.getUTCDate()
  if (granularity === 'month') {
    return `${y}-${String(m + 1).padStart(2, '0')}-01`
  }
  if (granularity === 'week') {
    // 주 시작(월요일) 계산
    const dayOfWeek = kst.getUTCDay() // 0=Sun..6=Sat
    const diff = (dayOfWeek + 6) % 7 // Mon=0
    const mondayUtc = Date.UTC(y, m, d - diff)
    return new Date(mondayUtc).toISOString().split('T')[0]
  }
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl

  const granularityParam = searchParams.get('granularity')
  const granularity: Granularity =
    granularityParam === 'week' || granularityParam === 'month' ? granularityParam : 'day'

  const locationId = searchParams.get('locationId') || undefined
  const channelId = searchParams.get('channelId') || undefined
  const channelGroupId = searchParams.get('channelGroupId') || undefined

  // Parse movementTypes filter (comma-separated)
  const VALID_TYPES: MoveType[] = ['INBOUND', 'OUTBOUND', 'RETURN', 'TRANSFER', 'ADJUSTMENT']
  const movementTypesParam = searchParams.get('movementTypes')
  const movementTypes: MoveType[] | undefined = movementTypesParam
    ? (movementTypesParam.split(',').filter((t) => VALID_TYPES.includes(t as MoveType)) as MoveType[])
    : undefined

  let from = parseKstDate(searchParams.get('from'))
  let to = parseKstDate(searchParams.get('to'), true)

  // 기본: 최근 30일
  if (!to) {
    const now = new Date()
    const kst = new Date(now.getTime() + KST_OFFSET_MS)
    const y = kst.getUTCFullYear()
    const m = kst.getUTCMonth()
    const d = kst.getUTCDate()
    const endUtc = Date.UTC(y, m, d, 23, 59, 59, 999)
    to = new Date(endUtc - KST_OFFSET_MS)
  }
  if (!from) {
    from = new Date(to.getTime() - 29 * 86400 * 1000)
    // Align from to start-of-day KST
    const kst = new Date(from.getTime() + KST_OFFSET_MS)
    const y = kst.getUTCFullYear()
    const m = kst.getUTCMonth()
    const d = kst.getUTCDate()
    from = new Date(Date.UTC(y, m, d, 0, 0, 0) - KST_OFFSET_MS)
  }

  // 채널 그룹 해석
  let channelInFilter: string | { in: string[] } | undefined
  if (channelId) channelInFilter = channelId
  else if (channelGroupId) {
    const channels = await prisma.invSalesChannel.findMany({
      where: { spaceId, groupId: channelGroupId },
      select: { id: true },
    })
    const ids = channels.map((c) => c.id)
    channelInFilter = { in: ids.length > 0 ? ids : ['__none__'] }
  }

  const where: {
    spaceId: string
    locationId?: string
    movementDate: { gte: Date; lte: Date }
    channelId?: string | { in: string[] }
    type?: { in: MoveType[] }
  } = {
    spaceId,
    movementDate: { gte: from, lte: to },
  }
  if (locationId) where.locationId = locationId
  if (movementTypes?.length) where.type = { in: movementTypes }

  // 모든 이동 조회. 채널 필터는 OUTBOUND에만 적용되어야 하므로 후처리에서 거름
  const movements = await prisma.invMovement.findMany({
    where,
    select: {
      type: true,
      quantity: true,
      movementDate: true,
      channelId: true,
      locationId: true,
      toLocationId: true,
    },
  })

  const channelIdSet: Set<string> | null =
    channelInFilter && typeof channelInFilter === 'object' && 'in' in channelInFilter
      ? new Set(channelInFilter.in)
      : null
  const singleChannelId =
    typeof channelInFilter === 'string' ? channelInFilter : null

  // 버킷 초기화
  const bucket = new Map<
    string,
    { inbound: number; outbound: number; return: number; transfer: number; adjustment: number }
  >()

  function ensureBucket(key: string) {
    let b = bucket.get(key)
    if (!b) {
      b = { inbound: 0, outbound: 0, return: 0, transfer: 0, adjustment: 0 }
      bucket.set(key, b)
    }
    return b
  }

  // from~to 범위 모든 버킷을 0으로 채워 빈 구간도 출력되도록 함
  {
    const cursor = new Date(from.getTime())
    // 최대 400 버킷 안전장치
    for (let i = 0; i < 400; i++) {
      if (cursor.getTime() > to.getTime()) break
      ensureBucket(bucketKey(cursor, granularity))
      if (granularity === 'month') {
        const kst = new Date(cursor.getTime() + KST_OFFSET_MS)
        kst.setUTCMonth(kst.getUTCMonth() + 1)
        cursor.setTime(kst.getTime() - KST_OFFSET_MS)
      } else if (granularity === 'week') {
        cursor.setTime(cursor.getTime() + 7 * 86400 * 1000)
      } else {
        cursor.setTime(cursor.getTime() + 86400 * 1000)
      }
    }
  }

  for (const m of movements) {
    const type = m.type as MoveType
    // OUTBOUND 이면서 채널 필터가 있으면 필터 적용
    if (type === 'OUTBOUND' && (singleChannelId || channelIdSet)) {
      if (singleChannelId && m.channelId !== singleChannelId) continue
      if (channelIdSet && (!m.channelId || !channelIdSet.has(m.channelId))) continue
    }
    // TRANSFER는 source decrement event 한 번만 카운트 — InvMovement 구조상
    // source는 locationId, 대상은 toLocationId. 일반적으로 한 행 = 한 transfer이므로 그대로 카운트.
    const key = bucketKey(m.movementDate, granularity)
    const b = ensureBucket(key)
    const qty = Math.abs(m.quantity)
    switch (type) {
      case 'INBOUND':
        b.inbound += qty
        break
      case 'OUTBOUND':
        b.outbound += qty
        break
      case 'RETURN':
        b.return += qty
        break
      case 'TRANSFER':
        b.transfer += qty
        break
      case 'ADJUSTMENT':
        b.adjustment += qty
        break
    }
  }

  const series = Array.from(bucket.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return NextResponse.json({
    series,
    from: toKstYmd(from),
    to: toKstYmd(to),
    granularity,
  })
}
