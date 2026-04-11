import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') ?? ''
  const sortBy = searchParams.get('sortBy') ?? 'productName'
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' as const : 'asc' as const
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 50)))
  const snapshotDate = searchParams.get('snapshotDate')

  // 필터 파라미터
  const isItemWinner = searchParams.get('isItemWinner') ?? 'all'
  const productNameFilter = searchParams.get('productNameFilter') ?? ''
  const productGrade = searchParams.get('productGrade') ?? 'all'
  const excludedView = searchParams.get('excludedView') ?? 'active'

  // 최신 스냅샷 날짜 결정
  let targetDate: Date | undefined
  if (snapshotDate) {
    targetDate = new Date(snapshotDate)
  } else {
    const latest = await prisma.inventoryUpload.findFirst({
      where: { workspaceId: resolved.workspace.id },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    targetDate = latest?.snapshotDate
  }

  if (!targetDate) {
    return NextResponse.json({ records: [], total: 0, snapshotDate: null, productNames: [] })
  }

  // 제외 옵션 목록 조회
  const excludedOptions = await prisma.inventoryExcludedProduct.findMany({
    where: { workspaceId: resolved.workspace.id },
    select: { optionId: true },
  })
  const excludedOptionIds = excludedOptions.map(e => e.optionId)

  // where 절 구성
  const where: Record<string, unknown> = {
    workspaceId: resolved.workspace.id,
    snapshotDate: targetDate,
  }

  // 상품명 필터 (정확 매칭이 검색보다 우선)
  if (productNameFilter) {
    where.productName = productNameFilter
  } else if (search) {
    where.productName = { contains: search, mode: 'insensitive' }
  }

  // 위너 필터
  if (isItemWinner === 'true') where.isItemWinner = true
  else if (isItemWinner === 'false') where.isItemWinner = false

  // 상품등급 필터 — "반품"은 "반품-최상", "반품-중" 등 포함 검색
  if (productGrade === '반품') where.productGrade = { contains: '반품' }
  else if (productGrade !== 'all') where.productGrade = productGrade

  // 제외 옵션 필터
  if (excludedView === 'excluded') {
    if (excludedOptionIds.length > 0) {
      where.optionId = { in: excludedOptionIds }
    } else {
      return NextResponse.json({ records: [], total: 0, snapshotDate: targetDate.toISOString(), productNames: [], excludedOptionIds: [] })
    }
  } else if (excludedView === 'active') {
    if (excludedOptionIds.length > 0) {
      where.optionId = { notIn: excludedOptionIds }
    }
  }

  const allowedSorts = ['productName', 'availableStock', 'revenue30d', 'salesQty30d', 'storageFee', 'conversionRate', 'returns30d']
  const orderField = allowedSorts.includes(sortBy) ? sortBy : 'productName'

  // non-nullable 필드(productName)는 plain SortOrder만 허용, nullable은 nulls: 'last' 가능
  const nonNullableFields = ['productName']
  const orderByValue = nonNullableFields.includes(orderField)
    ? sortOrder
    : { sort: sortOrder, nulls: 'last' as const }

  const [records, total, productNamesResult] = await Promise.all([
    prisma.inventoryRecord.findMany({
      where,
      orderBy: { [orderField]: orderByValue },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryRecord.count({ where }),
    prisma.inventoryRecord.findMany({
      where: { workspaceId: resolved.workspace.id, snapshotDate: targetDate },
      select: { productName: true },
      distinct: ['productName'],
      orderBy: { productName: 'asc' },
    }),
  ])

  return NextResponse.json({
    records,
    total,
    page,
    limit,
    snapshotDate: targetDate.toISOString(),
    excludedOptionIds,
    productNames: productNamesResult.map(p => p.productName),
  })
}
