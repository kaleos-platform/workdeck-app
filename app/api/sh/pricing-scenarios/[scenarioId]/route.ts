import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { pricingScenarioPatchSchema } from '@/lib/sh/schemas'
import { calculatePricing } from '@/lib/sh/pricing-calc'
type Decimal = { toString(): string }

// Decimal → number 변환 헬퍼
function d(v: Decimal | null | undefined): number {
  if (v == null) return 0
  return Number(v.toString())
}

type RouteContext = { params: Promise<{ scenarioId: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { scenarioId } = await params

  const scenario = await prisma.pricingScenario.findFirst({
    where: { id: scenarioId, spaceId: resolved.space.id },
    include: {
      channel: { select: { id: true, name: true } },
      channels: {
        orderBy: { sortOrder: 'asc' },
        include: {
          channel: {
            select: {
              id: true,
              name: true,
              channelType: true,
              defaultFeePct: true,
              shippingFee: true,
              freeShippingThreshold: true,
              applyAdCost: true,
              paymentFeeIncluded: true,
              paymentFeePct: true,
            },
          },
        },
      },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          option: {
            select: {
              id: true,
              name: true,
              sku: true,
              costPrice: true,
              retailPrice: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  brand: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!scenario) return errorResponse('시나리오를 찾을 수 없습니다', 404)

  // Decimal 직렬화
  const data = {
    ...scenario,
    vatRate: d(scenario.vatRate),
    promotionValue: scenario.promotionValue != null ? d(scenario.promotionValue) : null,
    channels: scenario.channels.map((sc) => ({
      id: sc.channel.id,
      name: sc.channel.name,
      channelType: sc.channel.channelType,
      defaultFeePct: sc.channel.defaultFeePct != null ? d(sc.channel.defaultFeePct) : 0,
      shippingFee: sc.channel.shippingFee != null ? d(sc.channel.shippingFee) : 0,
      freeShippingThreshold:
        sc.channel.freeShippingThreshold != null ? d(sc.channel.freeShippingThreshold) : null,
      applyAdCost: sc.channel.applyAdCost,
      paymentFeeIncluded: sc.channel.paymentFeeIncluded,
      paymentFeePct: sc.channel.paymentFeePct != null ? d(sc.channel.paymentFeePct) : 0,
    })),
    items: scenario.items.map((it) => ({
      ...it,
      costPrice: it.costPrice != null ? d(it.costPrice) : null,
      salePrice: d(it.salePrice),
      discountRate: d(it.discountRate),
      channelFeePct: d(it.channelFeePct),
      shippingCost: d(it.shippingCost),
      packagingCost: d(it.packagingCost),
      adCostPct: d(it.adCostPct),
      operatingCostPct: d(it.operatingCostPct),
      finalPrice: d(it.finalPrice),
      revenueExVat: d(it.revenueExVat),
      totalCost: d(it.totalCost),
      netProfit: d(it.netProfit),
      margin: d(it.margin),
      // option은 optionId が null인 경우 null
      option: it.option
        ? {
            ...it.option,
            costPrice: it.option.costPrice != null ? d(it.option.costPrice) : null,
            retailPrice: it.option.retailPrice != null ? d(it.option.retailPrice) : null,
          }
        : null,
    })),
  }

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { scenarioId } = await params

  // 기존 시나리오 소속 확인
  const existing = await prisma.pricingScenario.findFirst({
    where: { id: scenarioId, spaceId: resolved.space.id },
    select: { id: true, includeVat: true, vatRate: true },
  })
  if (!existing) return errorResponse('시나리오를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = pricingScenarioPatchSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, {
      issues: parsed.error.issues,
    })
  }
  const input = parsed.data

  // channelId 소속 검증 (레거시)
  if (input.channelId) {
    const channel = await prisma.channel.findFirst({
      where: { id: input.channelId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)
  }

  // channels[] 또는 channelIds 정규화 — channels가 있으면 우선 사용
  // undefined: 변경 없음 / []: 전체 삭제 / [...]: 교체
  const resolvedChannelIds: string[] | undefined =
    input.channels !== undefined
      ? input.channels.flatMap((c) => (c.channelId ? [c.channelId] : []))
      : input.channelIds

  // channelIds 소속 검증 (M-N)
  if (resolvedChannelIds && resolvedChannelIds.length > 0) {
    const validChannels = await prisma.channel.findMany({
      where: { id: { in: resolvedChannelIds }, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (validChannels.length !== resolvedChannelIds.length) {
      return errorResponse('유효하지 않은 채널이 포함되어 있습니다', 400)
    }
  }

  // items가 있으면 optionId 소속 검증 — null 항목(수동 입력 행)은 skip
  if (input.items && input.items.length > 0) {
    const optionIds = input.items.map((it) => it.optionId).filter((id): id is string => id != null)
    if (optionIds.length > 0) {
      const validOptions = await prisma.invProductOption.findMany({
        where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
        select: { id: true },
      })
      if (validOptions.length !== optionIds.length) {
        return errorResponse('유효하지 않은 옵션이 포함되어 있습니다', 400)
      }
    }
  }

  // 계산에 사용할 vatRate / includeVat — 입력값 우선, 없으면 기존값 사용
  const effectiveIncludeVat = input.includeVat ?? existing.includeVat
  const effectiveVatRate = input.vatRate ?? Number(existing.vatRate.toString())

  await prisma.$transaction(async (tx) => {
    // 메타 업데이트
    await tx.pricingScenario.update({
      where: { id: scenarioId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.memo !== undefined && { memo: input.memo ?? null }),
        ...('channelId' in input && { channelId: input.channelId ?? null }),
        ...(input.includeVat !== undefined && { includeVat: input.includeVat }),
        ...(input.vatRate !== undefined && { vatRate: input.vatRate }),
        ...(input.promotionType !== undefined && { promotionType: input.promotionType }),
        ...(input.promotionValue !== undefined && { promotionValue: input.promotionValue ?? null }),
        ...(input.applyReturnAdjustment !== undefined && {
          applyReturnAdjustment: input.applyReturnAdjustment,
        }),
      },
    })

    // channels[] 또는 channelIds가 있으면 M-N 채널 목록 전체 교체 (resolvedChannelIds로 정규화됨)
    if (resolvedChannelIds !== undefined) {
      await tx.pricingScenarioChannel.deleteMany({ where: { scenarioId } })
      if (resolvedChannelIds.length > 0) {
        await tx.pricingScenarioChannel.createMany({
          data: resolvedChannelIds.map((channelId, idx) => ({
            scenarioId,
            channelId,
            sortOrder: idx,
          })),
        })
      }
    }

    // items가 있으면 전체 교체 (deleteMany → createMany)
    if (input.items && input.items.length > 0) {
      await tx.pricingScenarioItem.deleteMany({ where: { scenarioId } })
      await tx.pricingScenarioItem.createMany({
        data: input.items.map((it, idx) => {
          const result = calculatePricing({
            costPrice: it.costPrice ?? 0,
            salePrice: it.salePrice,
            discountRate: it.discountRate,
            channelFeePct: it.channelFeePct,
            shippingCost: it.shippingCost,
            packagingCost: it.packagingCost,
            adCostPct: it.adCostPct,
            operatingCostPct: it.operatingCostPct,
            includeVat: effectiveIncludeVat,
            vatRate: effectiveVatRate,
          })
          return {
            scenarioId,
            optionId: it.optionId ?? null,
            manualName: it.manualName ?? null,
            manualBrandName: it.manualBrandName ?? null,
            unitsPerSet: it.unitsPerSet,
            costPrice: it.costPrice ?? null,
            salePrice: it.salePrice,
            discountRate: it.discountRate,
            channelFeePct: it.channelFeePct,
            shippingCost: it.shippingCost,
            packagingCost: it.packagingCost,
            adCostPct: it.adCostPct,
            operatingCostPct: it.operatingCostPct,
            sortOrder: it.sortOrder ?? idx,
            finalPrice: result.finalPrice,
            revenueExVat: result.revenueExVat,
            totalCost: result.totalCost,
            netProfit: result.netProfit,
            margin: result.margin,
          }
        }),
      })
    }
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { scenarioId } = await params

  const existing = await prisma.pricingScenario.findFirst({
    where: { id: scenarioId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('시나리오를 찾을 수 없습니다', 404)

  // cascade로 items, channels도 함께 삭제됨
  await prisma.pricingScenario.delete({ where: { id: scenarioId } })

  return NextResponse.json({ ok: true })
}
