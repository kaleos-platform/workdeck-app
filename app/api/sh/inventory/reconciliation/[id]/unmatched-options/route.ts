// 이번 대조에 등장하지 않은 시스템 옵션 목록 — "재고 데이터 없는 상품 보기" 다이얼로그용.
//
// 대조 테이블은 파일/데이터 연동 기준 워킹셋이라 시스템 쪽 미등장 옵션을 담지 않는다.
// 그 옵션들을 여기서 상품 단위로 묶어 보여주고, 자동 대조가 손대지 못하는 건
// (system-only + 매핑 없음)만 "연결 필요"로 표시한다.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { findMappedSystemOnlyKeys } from '@/lib/inv/reconciliation-processor'
import type { MatchEntry } from '@/lib/inv/reconciliation-matcher'
import { resolveFileOnlyEntries } from '@/lib/inv/reconciliation-resolve'

type RouteContext = { params: Promise<{ id: string }> }

// Prisma 파라미터가 비대해지는 것을 막는 임계치 — 초과 시 앱 레벨 필터로 폴백한다.
const NOT_IN_LIMIT = 2000

// GET /api/sh/inventory/reconciliation/[id]/unmatched-options
//   ?search=&page=&pageSize=&needsLinkOnly=1
export async function GET(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const recon = await prisma.invReconciliation.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, locationId: true, matchResults: true },
  })
  if (!recon) return errorResponse('대조 기록을 찾을 수 없습니다', 404)

  const { searchParams } = req.nextUrl
  const search = (searchParams.get('search') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize') ?? 10)))
  const needsLinkOnly = searchParams.get('needsLinkOnly') === '1'

  // 상세 GET 과 같은 규칙으로 file-only 를 풀어야, 방금 매칭한 옵션이 즉시 목록에서 빠진다.
  const rawEntries = (recon.matchResults ?? []) as MatchEntry[]
  const entries = await resolveFileOnlyEntries(rawEntries, recon.locationId)

  const matchedOptionIds = Array.from(
    new Set(
      entries
        .filter((e) => e.status === 'matched-diff' || e.status === 'matched-equal')
        .map((e) => e.optionId)
    )
  )

  // 자동 0 처리가 불가능한 system-only(= 외부 SKU 매핑 없음) → "연결 필요"
  const mappedKeys = await findMappedSystemOnlyKeys(entries, recon.locationId)
  const needsLinkOptionIds = new Set(
    entries
      .filter((e) => e.status === 'system-only')
      .filter((e) => !mappedKeys.has(`${e.locationId ?? recon.locationId}|${e.optionId}`))
      .map((e) => e.optionId)
  )

  // notIn/in 을 같은 `id` 키에 겹쳐 쓰면 한쪽이 덮어써지므로 AND 로 합친다.
  const useNotIn = matchedOptionIds.length <= NOT_IN_LIMIT
  const optionConds: { id: { notIn: string[] } | { in: string[] } }[] = []
  if (useNotIn && matchedOptionIds.length > 0) optionConds.push({ id: { notIn: matchedOptionIds } })
  if (needsLinkOnly) optionConds.push({ id: { in: Array.from(needsLinkOptionIds) } })
  const optionWhere = optionConds.length > 0 ? { AND: optionConds } : {}
  // 임계치 초과 시에는 DB 필터를 포기하고 앱 레벨에서 걸러낸다.
  const matchedSet = useNotIn ? null : new Set(matchedOptionIds)

  const productWhere = {
    spaceId: resolved.space.id,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            {
              options: {
                some: { name: { contains: search, mode: 'insensitive' as const } },
              },
            },
          ],
        }
      : {}),
    options: { some: optionWhere },
  }

  const [products, totalProducts] = await Promise.all([
    prisma.invProduct.findMany({
      where: productWhere,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        options: {
          where: optionWhere,
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        },
      },
    }),
    prisma.invProduct.count({ where: productWhere }),
  ])

  // 페이지에 실린 옵션의 해당 보관위치 재고만 배치 조회
  const pageOptionIds = products.flatMap((p) =>
    p.options.filter((o) => !matchedSet || !matchedSet.has(o.id)).map((o) => o.id)
  )
  const stocks = pageOptionIds.length
    ? await prisma.invStockLevel.findMany({
        where: { locationId: recon.locationId, optionId: { in: pageOptionIds } },
        select: { optionId: true, quantity: true },
      })
    : []
  const stockByOption = new Map(stocks.map((s) => [s.optionId, s.quantity]))

  const result = products.map((p) => {
    const options = p.options
      .filter((o) => !matchedSet || !matchedSet.has(o.id))
      .map((o) => ({
        id: o.id,
        name: o.name,
        quantity: stockByOption.get(o.id) ?? 0,
        needsLink: needsLinkOptionIds.has(o.id),
      }))
    return {
      id: p.id,
      name: p.name,
      options,
      unmatchedCount: options.length,
      stockSum: options.reduce((sum, o) => sum + o.quantity, 0),
    }
  })

  // 미등장 옵션 총계 — 페이지와 무관하되 검색·필터는 반영해야 상품 수와 아귀가 맞는다.
  const rawTotalOptions = await prisma.invProductOption.count({
    where: { ...optionWhere, product: productWhere },
  })
  // 폴백 경로에서는 매칭분이 DB 필터로 빠지지 않았으므로 총계에서 뺀다(근사).
  const totalOptions = matchedSet ? Math.max(0, rawTotalOptions - matchedSet.size) : rawTotalOptions

  return NextResponse.json({
    products: result,
    totalProducts,
    totalOptions,
    needsLinkTotal: needsLinkOptionIds.size,
    page,
    pageSize,
  })
}
