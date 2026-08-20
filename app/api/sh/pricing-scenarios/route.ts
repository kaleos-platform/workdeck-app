import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { pricingScenarioSaveSchema } from '@/lib/sh/schemas'
import { parseSnapshot } from '@/lib/sh/pricing-scenario-snapshot'
import type { PricingScenarioTarget } from '@/lib/sh/pricing-scenario-query'
import {
  collectPricingScenarioChannelIds,
  getPricingScenarioChannelIds,
  matchPricingScenarioToListingGroup,
} from '@/lib/sh/pricing-scenario-query'

type ScenarioListRow = {
  id: string
  name: string
  memo: string | null
  productIds: string[]
  channelId: string | null
  inputSnapshot: unknown
  updatedAt: Date
  createdAt: Date
}

// 목록 카드용 요약 (스냅샷에서 추출)
function cardSummary(inputSnapshot: unknown) {
  const snap = parseSnapshot(inputSnapshot)
  return snap?.summary ?? null
}

async function resolveListingGroupTarget(
  spaceId: string,
  channelProductId: string
): Promise<PricingScenarioTarget | null> {
  const cp = await prisma.channelProduct.findFirst({
    where: { id: channelProductId, spaceId },
    select: {
      channelId: true,
      listings: {
        select: {
          items: { select: { option: { select: { productId: true } } } },
        },
      },
    },
  })
  if (!cp) return null

  const productIds = new Set<string>()
  for (const listing of cp.listings) {
    for (const item of listing.items) productIds.add(item.option.productId)
  }

  return { channelId: cp.channelId, productIds: [...productIds] }
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()
  const productId = (searchParams.get('productId') ?? '').trim()
  const channelId = (searchParams.get('channelId') ?? '').trim()
  const channelProductId = (searchParams.get('channelProductId') ?? '').trim()

  const listingGroupTarget = channelProductId
    ? await resolveListingGroupTarget(resolved.space.id, channelProductId)
    : null
  if (channelProductId && !listingGroupTarget) {
    return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)
  }

  const target = listingGroupTarget ?? {
    productIds: productId ? [productId] : [],
    channelId,
  }
  if (channelProductId && target.productIds.length === 0) {
    return NextResponse.json({ data: [], total: 0, page, pageSize })
  }
  const needsChannelFilter = target.productIds.length > 0 && Boolean(target.channelId)

  const where: Prisma.PricingScenarioWhereInput = { spaceId: resolved.space.id }
  if (target.productIds.length > 0) {
    where.productIds =
      target.productIds.length === 1 ? { has: target.productIds[0] } : { hasSome: target.productIds }
  } else if (productId) {
    where.productIds = { has: productId }
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { memo: { contains: search, mode: 'insensitive' } },
    ]
  }

  const scenarioSelect = {
    id: true,
    name: true,
    memo: true,
    productIds: true,
    channelId: true,
    inputSnapshot: true,
    updatedAt: true,
    createdAt: true,
  } satisfies Prisma.PricingScenarioSelect

  const [scenarios, total]: readonly [ScenarioListRow[], number] = needsChannelFilter
    ? await prisma.pricingScenario
        .findMany({ where, orderBy: { updatedAt: 'desc' }, select: scenarioSelect })
        .then((candidates: ScenarioListRow[]) => {
          const filtered = candidates.filter((scenario) =>
            matchPricingScenarioToListingGroup({
              scenarioProductIds: scenario.productIds,
              channelId: scenario.channelId,
              inputSnapshot: scenario.inputSnapshot,
              target,
            })
          )
          return [filtered.slice((page - 1) * pageSize, page * pageSize), filtered.length] as const
        })
    : await Promise.all([
        prisma.pricingScenario.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: scenarioSelect,
        }),
        prisma.pricingScenario.count({ where }),
      ])

  const channelIds = collectPricingScenarioChannelIds(scenarios)
  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds }, spaceId: resolved.space.id },
        select: { id: true, name: true },
      })
    : []
  const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]))

  const data = scenarios.map((s) => {
    const rowChannelIds = getPricingScenarioChannelIds(s)
    return {
      id: s.id,
      name: s.name,
      memo: s.memo,
      productIds: s.productIds,
      channelIds: rowChannelIds,
      channelNames: rowChannelIds.map((id) => channelNameById.get(id) ?? id),
      summary: cardSummary(s.inputSnapshot),
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
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
