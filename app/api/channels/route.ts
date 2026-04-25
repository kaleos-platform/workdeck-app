import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelSchema } from '@/lib/sh/schemas'

export async function GET(req: NextRequest) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const isActiveParam = searchParams.get('isActive')
  const kindParam = searchParams.get('kind')
  const groupId = searchParams.get('groupId')

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false
  if (kindParam) where.kind = kindParam
  if (groupId) where.groupId = groupId

  const channels = await prisma.channel.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      group: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ channels })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelSchema.safeParse(body)
  if (!parsed.success) {
    console.error('[channels POST] invalid input', {
      spaceId: resolved.space.id,
      body,
      errors: parsed.error.flatten(),
    })
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const {
    name,
    kind,
    channelType,
    groupId,
    isActive,
    adminUrl,
    freeShipping,
    freeShippingThreshold,
    defaultFeePct,
    usesMarketingBudget,
    applyAdCost,
    shippingFee,
    vatIncludedInFee,
    paymentFeeIncluded,
    paymentFeePct,
    requireOrderNumber,
    requirePayment,
    requireProducts,
  } = parsed.data

  // groupId 소속 검증
  if (groupId) {
    const group = await prisma.channelGroup.findFirst({
      where: { id: groupId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!group) return errorResponse('채널 그룹을 찾을 수 없습니다', 404)
  }

  try {
    const channel = await prisma.channel.create({
      data: {
        spaceId: resolved.space.id,
        name,
        kind,
        channelType,
        groupId: groupId ?? null,
        isActive,
        adminUrl: adminUrl ?? null,
        freeShipping,
        freeShippingThreshold: freeShippingThreshold ?? null,
        defaultFeePct: defaultFeePct ?? null,
        usesMarketingBudget,
        applyAdCost,
        shippingFee: shippingFee ?? null,
        vatIncludedInFee,
        paymentFeeIncluded,
        paymentFeePct: paymentFeePct ?? null,
        requireOrderNumber,
        requirePayment,
        requireProducts,
      },
      include: {
        group: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({ channel }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 채널 이름이 존재합니다', 409)
    }
    throw err
  }
}
