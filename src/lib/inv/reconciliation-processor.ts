// 재고 대조 확정 처리기 — 선택된 diff 를 ADJUSTMENT 이동으로 반영한다.
import { prisma } from '@/lib/prisma'
import { processMovement, MovementError } from './movement-processor'
import type { MatchEntry } from './reconciliation-matcher'

export type ConfirmOptions = {
  selectedOptionIds: string[]
  manualMappings: { externalCode: string; optionId: string }[]
}

export type ConfirmResult = { adjustedCount: number }

export async function confirmReconciliation(
  spaceId: string,
  reconciliationId: string,
  options: ConfirmOptions
): Promise<ConfirmResult> {
  const recon = await prisma.invReconciliation.findUnique({
    where: { id: reconciliationId },
  })
  if (!recon || recon.spaceId !== spaceId) {
    throw new MovementError('대조 기록을 찾을 수 없습니다', 404)
  }
  if (recon.status !== 'PENDING') {
    throw new MovementError('이미 확정되었거나 취소된 대조입니다', 400)
  }

  const entries = (recon.matchResults as unknown as MatchEntry[]) ?? []
  const { locationId, snapshotDate, fileName } = recon

  // 1) 수동 매핑 upsert + 해당 file-only 항목을 adjustment 후보로 변환
  const extraAdjustments: {
    optionId: string
    fileQuantity: number
  }[] = []

  for (const mm of options.manualMappings) {
    if (!mm.externalCode || !mm.optionId) continue

    // 옵션 소유권 확인
    const option = await prisma.invProductOption.findFirst({
      where: { id: mm.optionId, product: { spaceId } },
      include: { product: { select: { name: true } } },
    })
    if (!option) continue

    // 대응하는 file-only 엔트리 찾기
    const entry = entries.find(
      (e) => e.status === 'file-only' && e.row.externalCode === mm.externalCode
    )
    if (!entry || entry.status !== 'file-only') continue

    // Upsert mapping
    const existing = await prisma.invLocationProductMap.findUnique({
      where: {
        locationId_externalCode: { locationId, externalCode: mm.externalCode },
      },
    })
    if (existing) {
      if (existing.optionId !== mm.optionId) {
        await prisma.invLocationProductMap.update({
          where: { id: existing.id },
          data: {
            optionId: mm.optionId,
            externalName: entry.row.externalName ?? existing.externalName,
            externalOptionName:
              entry.row.externalOptionName ?? existing.externalOptionName,
          },
        })
      }
    } else {
      await prisma.invLocationProductMap.create({
        data: {
          spaceId,
          locationId,
          optionId: mm.optionId,
          externalCode: mm.externalCode,
          externalName: entry.row.externalName ?? null,
          externalOptionName: entry.row.externalOptionName ?? null,
        },
      })
    }

    // 선택된 경우에만 조정 대상에 추가
    if (options.selectedOptionIds.includes(mm.optionId)) {
      extraAdjustments.push({
        optionId: mm.optionId,
        fileQuantity: entry.row.quantity,
      })
    }
  }

  // 2) matched-diff 중 선택된 항목 adjustment
  const selected = new Set(options.selectedOptionIds)
  const diffAdjustments: { optionId: string; fileQuantity: number }[] = []
  for (const e of entries) {
    if (e.status !== 'matched-diff') continue
    if (!selected.has(e.optionId)) continue
    diffAdjustments.push({
      optionId: e.optionId,
      fileQuantity: e.fileQuantity,
    })
  }

  const all = [...diffAdjustments, ...extraAdjustments]
  const movementDate = snapshotDate.toISOString()
  const snapshotStr = snapshotDate.toISOString().slice(0, 10)

  let adjustedCount = 0
  for (const adj of all) {
    try {
      await processMovement(spaceId, {
        type: 'ADJUSTMENT',
        optionId: adj.optionId,
        locationId,
        quantity: adj.fileQuantity,
        movementDate,
        reason: `파일 대조 조정 (${snapshotStr} 기준, 파일: ${fileName})`,
        referenceId: reconciliationId,
      })
      adjustedCount += 1
    } catch (err) {
      console.error('[confirmReconciliation] adjustment 실패', adj, err)
    }
  }

  await prisma.invReconciliation.update({
    where: { id: reconciliationId },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      adjustedItems: adjustedCount,
    },
  })

  return { adjustedCount }
}
