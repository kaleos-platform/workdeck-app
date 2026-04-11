import { NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  // 최신 스냅샷 날짜
  const latestUpload = await prisma.inventoryUpload.findFirst({
    where: { workspaceId: resolved.workspace.id },
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true, fileType: true, uploadedAt: true },
  })

  if (!latestUpload) {
    return NextResponse.json({
      snapshotDate: null,
      totalProducts: 0,
      outOfStock: 0,
      lowStock: 0,
      totalRevenue30d: 0,
      totalStorageFee: 0,
    })
  }

  const snapshotDate = latestUpload.snapshotDate

  // 제외 옵션 목록 조회
  const excludedOptions = await prisma.inventoryExcludedProduct.findMany({
    where: { workspaceId: resolved.workspace.id },
    select: { optionId: true },
  })
  const excludedOptionIds = excludedOptions.map(e => e.optionId)

  const base = { workspaceId: resolved.workspace.id, snapshotDate }
  const baseActive = excludedOptionIds.length > 0
    ? { ...base, optionId: { notIn: excludedOptionIds } }
    : base

  const [totalProducts, outOfStock, lowStock, aggregates] = await Promise.all([
    prisma.inventoryRecord.count({ where: baseActive }),
    prisma.inventoryRecord.count({
      where: { ...baseActive, availableStock: 0 },
    }),
    prisma.inventoryRecord.count({
      where: { ...baseActive, availableStock: { gt: 0, lte: 10 } },
    }),
    prisma.inventoryRecord.aggregate({
      where: baseActive,
      _sum: { storageFee: true, revenue30d: true },
    }),
  ])

  return NextResponse.json({
    snapshotDate: snapshotDate.toISOString(),
    uploadedAt: latestUpload.uploadedAt,
    fileType: latestUpload.fileType,
    totalProducts,
    outOfStock,
    lowStock,
    totalRevenue30d: aggregates._sum.revenue30d ?? 0,
    totalStorageFee: aggregates._sum.storageFee ?? 0,
  })
}
