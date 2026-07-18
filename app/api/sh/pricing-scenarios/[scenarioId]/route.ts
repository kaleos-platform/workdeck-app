import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { pricingScenarioSavePatchSchema } from '@/lib/sh/schemas'
import { parseSnapshot } from '@/lib/sh/pricing-scenario-snapshot'

type RouteContext = { params: Promise<{ scenarioId: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { scenarioId } = await params

  const scenario = await prisma.pricingScenario.findFirst({
    where: { id: scenarioId, spaceId: resolved.space.id },
    select: {
      id: true,
      name: true,
      memo: true,
      productIds: true,
      inputSnapshot: true,
      updatedAt: true,
      createdAt: true,
    },
  })

  if (!scenario) return errorResponse('시나리오를 찾을 수 없습니다', 404)

  return NextResponse.json({
    id: scenario.id,
    name: scenario.name,
    memo: scenario.memo,
    productIds: scenario.productIds,
    snapshot: parseSnapshot(scenario.inputSnapshot),
    updatedAt: scenario.updatedAt,
    createdAt: scenario.createdAt,
  })
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { scenarioId } = await params

  const existing = await prisma.pricingScenario.findFirst({
    where: { id: scenarioId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('시나리오를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = pricingScenarioSavePatchSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { issues: parsed.error.issues })
  }
  const input = parsed.data

  if (input.inputSnapshot !== undefined && !parseSnapshot(input.inputSnapshot)) {
    return errorResponse('시나리오 데이터 형식이 올바르지 않습니다', 400)
  }

  if (input.productIds && input.productIds.length > 0) {
    const validProducts = await prisma.invProduct.findMany({
      where: { id: { in: input.productIds }, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (validProducts.length !== input.productIds.length) {
      return errorResponse('유효하지 않은 상품이 포함되어 있습니다', 400)
    }
  }

  await prisma.pricingScenario.update({
    where: { id: scenarioId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.memo !== undefined && { memo: input.memo ?? null }),
      ...(input.productIds !== undefined && { productIds: input.productIds }),
      ...(input.inputSnapshot !== undefined && {
        inputSnapshot: input.inputSnapshot as Prisma.InputJsonValue,
      }),
    },
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

  // cascade로 레거시 items/channels도 함께 삭제됨
  await prisma.pricingScenario.delete({ where: { id: scenarioId } })

  return NextResponse.json({ ok: true })
}
