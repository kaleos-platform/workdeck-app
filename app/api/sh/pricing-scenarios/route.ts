import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { pricingScenarioSchema } from '@/lib/sh/schemas'
import { calculatePricing } from '@/lib/sh/pricing-calc'
type Decimal = { toString(): string }

// Decimal → number 변환 헬퍼
function d(v: Decimal | null | undefined): number {
  if (v == null) return 0
  return Number(v.toString())
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { memo: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [scenarios, total] = await Promise.all([
    prisma.pricingScenario.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        channel: { select: { id: true, name: true } },
        items: { select: { netProfit: true, margin: true } },
      },
    }),
    prisma.pricingScenario.count({ where }),
  ])

  const data = scenarios.map((s) => {
    const itemCount = s.items.length
    const totalNetProfit = Number(s.items.reduce((acc, it) => acc + d(it.netProfit), 0).toFixed(2))
    const averageMargin =
      itemCount === 0
        ? 0
        : Number((s.items.reduce((acc, it) => acc + d(it.margin), 0) / itemCount).toFixed(4))

    return {
      id: s.id,
      name: s.name,
      memo: s.memo,
      channel: s.channel,
      includeVat: s.includeVat,
      vatRate: d(s.vatRate),
      itemCount,
      totalNetProfit,
      averageMargin,
      updatedAt: s.updatedAt,
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = pricingScenarioSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, {
      issues: parsed.error.issues,
    })
  }
  const input = parsed.data

  // channelId 소속 검증
  if (input.channelId) {
    const channel = await prisma.channel.findFirst({
      where: { id: input.channelId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)
  }

  // optionId 소속 검증 (product.spaceId 경유)
  const optionIds = input.items.map((it) => it.optionId)
  const validOptions = await prisma.invProductOption.findMany({
    where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
    select: { id: true },
  })
  if (validOptions.length !== optionIds.length) {
    return errorResponse('유효하지 않은 옵션이 포함되어 있습니다', 400)
  }

  // 각 item 계산 후 트랜잭션 저장
  const scenario = await prisma.$transaction(async (tx) => {
    const created = await tx.pricingScenario.create({
      data: {
        spaceId: resolved.space.id,
        channelId: input.channelId ?? null,
        name: input.name,
        memo: input.memo ?? null,
        includeVat: input.includeVat,
        vatRate: input.vatRate,
      },
    })

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
          includeVat: input.includeVat,
          vatRate: input.vatRate,
        })
        return {
          scenarioId: created.id,
          optionId: it.optionId,
          costPrice: it.costPrice ?? null,
          salePrice: it.salePrice,
          discountRate: it.discountRate,
          channelFeePct: it.channelFeePct,
          shippingCost: it.shippingCost,
          packagingCost: it.packagingCost,
          adCostPct: it.adCostPct,
          operatingCostPct: it.operatingCostPct,
          sortOrder: it.sortOrder ?? idx,
          // 결과 캐시
          finalPrice: result.finalPrice,
          revenueExVat: result.revenueExVat,
          totalCost: result.totalCost,
          netProfit: result.netProfit,
          margin: result.margin,
        }
      }),
    })

    return created
  })

  return NextResponse.json({ id: scenario.id }, { status: 201 })
}
