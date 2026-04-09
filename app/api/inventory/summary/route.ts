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
      inboundPending: 0,
      totalStorageFee: 0,
    })
  }

  const snapshotDate = latestUpload.snapshotDate
  const base = { workspaceId: resolved.workspace.id, snapshotDate }

  const [totalProducts, outOfStock, lowStock, inboundPending, storageFeeAgg] = await Promise.all([
    prisma.inventoryRecord.count({ where: base }),
    prisma.inventoryRecord.count({
      where: { ...base, availableStock: 0 },
    }),
    prisma.inventoryRecord.count({
      where: { ...base, availableStock: { gt: 0, lte: 10 } },
    }),
    prisma.inventoryRecord.count({
      where: { ...base, inboundStock: { gt: 0 } },
    }),
    prisma.inventoryRecord.aggregate({
      where: base,
      _sum: { storageFee: true },
    }),
  ])

  return NextResponse.json({
    snapshotDate: snapshotDate.toISOString(),
    uploadedAt: latestUpload.uploadedAt,
    fileType: latestUpload.fileType,
    totalProducts,
    outOfStock,
    lowStock,
    inboundPending,
    totalStorageFee: storageFeeAgg._sum.storageFee ?? 0,
  })
}
