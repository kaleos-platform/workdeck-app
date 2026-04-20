import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  processMovement,
  MovementError,
  type MovementInput,
  type MovementType,
} from '@/lib/inv/movement-processor'

const VALID_TYPES: readonly MovementType[] = [
  'INBOUND',
  'OUTBOUND',
  'RETURN',
  'TRANSFER',
  'ADJUSTMENT',
] as const

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return errorResponse('요청 본문이 유효한 JSON이 아닙니다', 400)
  }

  const type = body.type as MovementType | undefined
  if (!type || !VALID_TYPES.includes(type)) {
    return errorResponse('type이 유효하지 않습니다', 400)
  }

  const input: MovementInput = {
    type,
    productName: typeof body.productName === 'string' ? body.productName : undefined,
    productCode:
      body.productCode === null
        ? null
        : typeof body.productCode === 'string'
          ? body.productCode
          : undefined,
    optionName: typeof body.optionName === 'string' ? body.optionName : undefined,
    optionSku:
      body.optionSku === null
        ? null
        : typeof body.optionSku === 'string'
          ? body.optionSku
          : undefined,
    optionId: typeof body.optionId === 'string' ? body.optionId : undefined,
    locationId: typeof body.locationId === 'string' ? body.locationId : '',
    toLocationId: typeof body.toLocationId === 'string' ? body.toLocationId : undefined,
    channelId: typeof body.channelId === 'string' ? body.channelId : undefined,
    quantity: typeof body.quantity === 'number' ? body.quantity : Number(body.quantity),
    movementDate: typeof body.movementDate === 'string' ? body.movementDate : '',
    orderDate: typeof body.orderDate === 'string' ? body.orderDate : undefined,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    referenceId: typeof body.referenceId === 'string' ? body.referenceId : undefined,
    importHistoryId: typeof body.importHistoryId === 'string' ? body.importHistoryId : undefined,
  }

  try {
    const result = await processMovement(resolved.space.id, input)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof MovementError) {
      return errorResponse(err.message, err.status)
    }
    console.error('[POST /api/inv/movements] 실패', err)
    return errorResponse('재고 이동 처리에 실패했습니다', 500)
  }
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50)))

  const typeParam = searchParams.get('type')
  const type =
    typeParam && (VALID_TYPES as readonly string[]).includes(typeParam)
      ? (typeParam as MovementType)
      : undefined
  const optionId = searchParams.get('optionId') ?? undefined
  const locationId = searchParams.get('locationId') ?? undefined
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: {
    spaceId: string
    type?: MovementType
    optionId?: string
    locationId?: string
    movementDate?: { gte?: Date; lte?: Date }
  } = { spaceId: resolved.space.id }

  if (type) where.type = type
  if (optionId) where.optionId = optionId
  if (locationId) where.locationId = locationId
  if (from || to) {
    where.movementDate = {}
    if (from) {
      const d = new Date(from)
      if (!Number.isNaN(d.getTime())) where.movementDate.gte = d
    }
    if (to) {
      const d = new Date(to)
      if (!Number.isNaN(d.getTime())) where.movementDate.lte = d
    }
  }

  const [data, total] = await Promise.all([
    prisma.invMovement.findMany({
      where,
      orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        option: { include: { product: { select: { id: true, name: true, code: true } } } },
        location: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true } },
      },
    }),
    prisma.invMovement.count({ where }),
  ])

  return NextResponse.json({ data, total, page, pageSize })
}
