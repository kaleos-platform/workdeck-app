import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelSchema } from '@/lib/sh/schemas'
import { normalizeFeeRates } from '@/lib/sh/channel-fee-lookup'
import { isExternalSource, EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { ensureCoupangLocation } from '@/lib/inv/coupang-channel-pairing'
import { validateRepresentativeChannel } from '@/lib/sh/channel-relation'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    include: {
      channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
      feeRates: { orderBy: { categoryName: 'asc' } },
    },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  return NextResponse.json({ channel })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const existing = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true, externalSource: true },
  })
  if (!existing) return errorResponse('채널을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelSchema.partial().safeParse(body)
  if (!parsed.success) {
    console.error('[channels PATCH] invalid input', {
      channelId,
      body,
      errors: parsed.error.flatten(),
    })
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // externalSource: channelSchema에 없어 별도 파싱 (Zod가 unknown key 제거)
  // body에 externalSource 키가 있을 때만 처리 (undefined면 필드 미변경)
  const hasExternalSourceKey = body !== null && typeof body === 'object' && 'externalSource' in body
  const rawExternalSource = hasExternalSourceKey
    ? (body as Record<string, unknown>).externalSource
    : undefined
  // null → null(해제), valid string → 설정, 그 외 → 무시(undefined)
  const externalSource: string | null | undefined = !hasExternalSourceKey
    ? undefined
    : rawExternalSource === null
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
    shippingFeeType,
    shippingFee,
    shippingFeePct,
    vatIncludedInFee,
    paymentFeeIncluded,
    paymentFeePct,
    requireOrderNumber,
    requirePayment,
    requireProducts,
    representativeChannelId,
    feeRates,
  } = parsed.data

  // channelTypeDefId 변경 시 소속 검증
  if (channelTypeDefId !== undefined) {
    const typeDef = await prisma.channelTypeDef.findFirst({
      where: { id: channelTypeDefId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!typeDef) return errorResponse('채널 유형을 찾을 수 없습니다', 404)
  }

  // 대표 채널 관계 무결성 검증 (representativeChannelId가 입력된 경우만)
  if (representativeChannelId !== undefined) {
    // 설정 주체의 externalSource: 이번 요청에서 바뀌면 그 값, 아니면 기존 값
    const effectiveExternalSource =
      externalSource !== undefined ? externalSource : existing.externalSource
    const relErr = await validateRepresentativeChannel({
      spaceId: resolved.space.id,
      selfChannelId: channelId,
      selfExternalSource: effectiveExternalSource,
      representativeChannelId,
    })
    if (relErr) return errorResponse(relErr, 400)
  }

  try {
    const channel = await prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(name !== undefined && { name }),
          ...(channelTypeDefId !== undefined && { channelTypeDefId }),
          ...(isActive !== undefined && { isActive }),
          ...(useSimulation !== undefined && { useSimulation }),
          ...(adminUrl !== undefined && { adminUrl: adminUrl ?? null }),
          ...(freeShipping !== undefined && { freeShipping }),
          ...(freeShippingThreshold !== undefined && {
            freeShippingThreshold: freeShippingThreshold ?? null,
          }),
          ...(usesMarketingBudget !== undefined && { usesMarketingBudget }),
          ...(applyAdCost !== undefined && { applyAdCost }),
          ...(shippingFeeType !== undefined && { shippingFeeType }),
          ...(shippingFee !== undefined && { shippingFee: shippingFee ?? null }),
          ...(shippingFeePct !== undefined && { shippingFeePct: shippingFeePct ?? null }),
          ...(vatIncludedInFee !== undefined && { vatIncludedInFee }),
          ...(paymentFeeIncluded !== undefined && { paymentFeeIncluded }),
          ...(paymentFeePct !== undefined && { paymentFeePct: paymentFeePct ?? null }),
          ...(requireOrderNumber !== undefined && { requireOrderNumber }),
          ...(requirePayment !== undefined && { requirePayment }),
          ...(requireProducts !== undefined && { requireProducts }),
          ...(externalSource !== undefined && { externalSource }),
          ...(representativeChannelId !== undefined && { representativeChannelId }),
        },
      })

      // feeRates가 입력되었을 때만 전체 교체. 항상 '기본' 1건 보장
      if (feeRates !== undefined) {
        const normalized = normalizeFeeRates(feeRates)
        await tx.channelFeeRate.deleteMany({ where: { channelId } })
        await tx.channelFeeRate.createMany({
          data: normalized.map((fr) => ({
            channelId,
            categoryName: fr.categoryName,
            ratePercent: fr.ratePercent,
          })),
        })
      }

      return tx.channel.findUniqueOrThrow({
        where: { id: channelId },
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
        console.warn('[channels PATCH] 위치 페어링 실패 (채널은 저장됨)', pairErr)
      }
    }

    return NextResponse.json({ channel })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const existing = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널을 찾을 수 없습니다', 404)

  // ChannelFeeRate, PricingScenarioChannel은 onDelete: Cascade로 자동 삭제됨
  await prisma.channel.delete({ where: { id: channelId } })

  return new NextResponse(null, { status: 204 })
}
