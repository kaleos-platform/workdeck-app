// 재고 대조 확정 처리기 — 선택된 diff 를 ADJUSTMENT 이동으로 반영한다.
import { prisma } from '@/lib/prisma'
import { processMovement, MovementError } from './movement-processor'
import type { MatchEntry } from './reconciliation-matcher'

export type ConfirmOptions = {
  selectedOptionIds: string[]
  manualMappings: { externalCode: string; optionId: string }[]
}

export type ConfirmResult = { adjustedCount: number; status: string }

/**
 * 적용 가능한 총 항목 수를 산출한다.
 * matched-diff 수 + file-only 중 InvLocationProductMap에 매핑된 수
 */
async function calcApplicableCount(entries: MatchEntry[], locationId: string): Promise<number> {
  // matched-diff 항목 수
  const matchedDiffCount = entries.filter((e) => e.status === 'matched-diff').length

  // file-only 항목 중 locationProductMap에 이미 매핑된 externalCode 수
  const fileOnlyExternalCodes = entries
    .filter((e) => e.status === 'file-only')
    .map((e) => e.row.externalCode)
    .filter(Boolean) as string[]

  let mappedFileOnlyCount = 0
  if (fileOnlyExternalCodes.length > 0) {
    mappedFileOnlyCount = await prisma.invLocationProductMap.count({
      where: {
        locationId,
        externalCode: { in: fileOnlyExternalCodes },
      },
    })
  }

  return matchedDiffCount + mappedFileOnlyCount
}

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
  // PENDING/PARTIAL 상태에서만 추가 confirm 허용
  if (!['PENDING', 'PARTIAL'].includes(recon.status)) {
    throw new MovementError('이미 적용 완료됐거나 확정·취소된 대조입니다', 400)
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
            externalOptionName: entry.row.externalOptionName ?? existing.externalOptionName,
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
    } catch (err) {
      console.error('[confirmReconciliation] adjustment 실패', adj, err)
    }
  }

  // 3) 누적 적용 항목 수 — DB에서 직접 집계 (retry 시 drift 방지)
  const appliedMovements = await prisma.invMovement.findMany({
    where: { referenceId: reconciliationId, type: 'ADJUSTMENT' },
    select: { optionId: true },
    distinct: ['optionId'],
  })
  const cumulativeApplied = appliedMovements.length

  // 4) 적용 가능 총수 산출
  const applicableTotal = await calcApplicableCount(entries, locationId)

  // 5) 상태 결정: 한 번이라도 confirm 호출 → 최소 PARTIAL
  //    누적 적용 == 적용 가능 총수이면 APPLIED
  const newStatus =
    applicableTotal > 0 && cumulativeApplied >= applicableTotal ? 'APPLIED' : 'PARTIAL'

  await prisma.invReconciliation.update({
    where: { id: reconciliationId },
    data: {
      status: newStatus,
      // confirmedAt은 finalize 액션에서만 기록
      adjustedItems: cumulativeApplied,
    },
  })

  return { adjustedCount: cumulativeApplied, status: newStatus }
}
