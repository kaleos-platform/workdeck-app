import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelSchema } from '@/lib/sh/schemas'
import { normalizeFeeRates } from '@/lib/sh/channel-fee-lookup'
import { isExternalSource, EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { ensureCoupangLocation } from '@/lib/inv/coupang-channel-pairing'
import { validateRepresentativeChannel } from '@/lib/sh/channel-relation'

export async function GET(req: NextRequest) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const isActiveParam = searchParams.get('isActive')
  const isSalesChannelParam = searchParams.get('isSalesChannel')
  const channelTypeDefId = searchParams.get('channelTypeDefId')

  const where: Prisma.ChannelWhereInput = { spaceId: resolved.space.id }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false
  if (isSalesChannelParam === 'true') where.channelTypeDef = { isSalesChannel: true }
  else if (isSalesChannelParam === 'false') where.channelTypeDef = { isSalesChannel: false }
  if (channelTypeDefId) where.channelTypeDefId = channelTypeDefId

  const channels = await prisma.channel.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
      feeRates: {
        select: { categoryName: true, ratePercent: true },
        orderBy: { categoryName: 'asc' },
      },
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

  // externalSource: channelSchema에 없어 별도 파싱 (Zod가 unknown key 제거)
  const rawExternalSource =
    body !== null && typeof body === 'object' && 'externalSource' in body
      ? (body as Record<string, unknown>).externalSource
      : undefined
  const externalSource =
    rawExternalSource === null
      ? null
      : isExternalSource(rawExternalSource)
        ? rawExternalSource
        : undefined

  const {
    name,
    channelTypeDefId,
    isActive,
    useSimulation,
    adminUrl,
    freeShipping,
    freeShippingThreshold,
    usesMarketingBudget,
    applyAdCost,
    shippingFee,
    vatIncludedInFee,
    paymentFeeIncluded,
    paymentFeePct,
    requireOrderNumber,
    requirePayment,
    requireProducts,
    representativeChannelId,
    feeRates,
  } = parsed.data

  // channelTypeDefId 소속 검증
  const typeDef = await prisma.channelTypeDef.findFirst({
    where: { id: channelTypeDefId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!typeDef) return errorResponse('채널 유형을 찾을 수 없습니다', 404)

  // 대표 채널 관계 무결성 검증 (생성 시 representativeChannelId가 입력된 경우만)
  if (representativeChannelId !== undefined) {
    const relErr = await validateRepresentativeChannel({
      spaceId: resolved.space.id,
      selfExternalSource: externalSource ?? null,
      representativeChannelId,
    })
    if (relErr) return errorResponse(relErr, 400)
  }

  // feeRates 정규화 — '기본' 카테고리는 항상 1건 보장
  const normalizedFeeRates = normalizeFeeRates(feeRates)

  try {
    const channel = await prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          spaceId: resolved.space.id,
          name,
          channelTypeDefId,
          isActive,
          useSimulation,
          adminUrl: adminUrl ?? null,
          freeShipping,
          freeShippingThreshold: freeShippingThreshold ?? null,
          usesMarketingBudget,
          applyAdCost,
          shippingFee: shippingFee ?? null,
          vatIncludedInFee,
          paymentFeeIncluded,
          paymentFeePct: paymentFeePct ?? null,
          requireOrderNumber,
          requirePayment,
          requireProducts,
          ...(externalSource !== undefined && { externalSource }),
          ...(representativeChannelId !== undefined && { representativeChannelId }),
        },
      })

      await tx.channelFeeRate.createMany({
        data: normalizedFeeRates.map((fr) => ({
          channelId: created.id,
          categoryName: fr.categoryName,
          ratePercent: fr.ratePercent,
        })),
      })

      return tx.channel.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
          feeRates: { orderBy: { categoryName: 'asc' } },
        },
      })
    })

    // 로켓그로스 소스 지정 시 페어 위치 보장 (best-effort)
    if (externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH) {
      try {
        const workspace = await prisma.workspace.findFirst({
          where: { ownerId: resolved.user.id },
          select: { id: true },
        })
        await ensureCoupangLocation(resolved.space.id, workspace?.id)
      } catch (pairErr) {
        console.warn('[channels POST] 위치 페어링 실패 (채널은 저장됨)', pairErr)
      }
    }

    return NextResponse.json({ channel }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      // meta.target으로 어느 unique 제약인지 구분
      const rawTarget = (err as { meta?: { target?: unknown } }).meta?.target
      const target = Array.isArray(rawTarget) ? (rawTarget as string[]) : []
      if (target.some((t) => typeof t === 'string' && t.includes('externalSource'))) {
        return errorResponse(
          '이미 다른 채널이 해당 소스에 연결되어 있습니다. 소스 연결을 해제한 후 다시 시도해 주세요',
          409
        )
      }
      return errorResponse('이미 동일한 채널 이름이 존재합니다', 409)
    }
    throw err
  }
}
