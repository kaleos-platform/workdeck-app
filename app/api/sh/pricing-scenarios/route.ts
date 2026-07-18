import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { pricingScenarioSaveSchema } from '@/lib/sh/schemas'
import { parseSnapshot } from '@/lib/sh/pricing-scenario-snapshot'

// 목록 카드용 요약 (스냅샷에서 추출)
function cardSummary(inputSnapshot: unknown) {
  const snap = parseSnapshot(inputSnapshot)
  return snap?.summary ?? null
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()
  const productId = (searchParams.get('productId') ?? '').trim()

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (productId) where.productIds = { has: productId }
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
      select: {
        id: true,
        name: true,
        memo: true,
        productIds: true,
        inputSnapshot: true,
        updatedAt: true,
        createdAt: true,
      },
    }),
    prisma.pricingScenario.count({ where }),
  ])

  const data = scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    memo: s.memo,
    productIds: s.productIds,
    summary: cardSummary(s.inputSnapshot),
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
  }))

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

  const parsed = pricingScenarioSaveSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { issues: parsed.error.issues })
  }
  const input = parsed.data

  // 스냅샷 형태 검증
  if (!parseSnapshot(input.inputSnapshot)) {
    return errorResponse('시나리오 데이터 형식이 올바르지 않습니다', 400)
  }

  // productIds 소속 검증 — 다른 space의 상품 ID 주입 차단
  if (input.productIds.length > 0) {
    const validProducts = await prisma.invProduct.findMany({
      where: { id: { in: input.productIds }, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (validProducts.length !== input.productIds.length) {
      return errorResponse('유효하지 않은 상품이 포함되어 있습니다', 400)
    }
  }

  const created = await prisma.pricingScenario.create({
    data: {
      spaceId: resolved.space.id,
      name: input.name,
      memo: input.memo ?? null,
      productIds: input.productIds,
      inputSnapshot: input.inputSnapshot as Prisma.InputJsonValue,
    },
    select: { id: true },
  })

  return NextResponse.json({ id: created.id }, { status: 201 })
}
