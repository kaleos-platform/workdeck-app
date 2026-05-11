// 재고 대조 확정 처리기 — 선택된 diff 를 ADJUSTMENT 이동으로 반영한다.
import { prisma } from '@/lib/prisma'
import { processMovement, MovementError } from './movement-processor'
import type { MatchEntry } from './reconciliation-matcher'

export type ManualMappingItem = {
  optionId: string
  quantity: number // 수량 비율 (기본 1)
}

export type ConfirmOptions = {
  selectedOptionIds: string[]
  manualMappings: { externalCode: string; items: ManualMappingItem[] }[]
}

export type ConfirmResult = { adjustedCount: number; status: string }

/**
 * 적용 가능한 총 항목 수를 산출한다.
 * matched-diff entry 수 + file-only 중 InvLocationProductMap에 매핑된 items 수
 */
async function calcApplicableCount(entries: MatchEntry[], locationId: string): Promise<number> {
  // matched-diff 항목 수
  const matchedDiffCount = entries.filter((e) => e.status === 'matched-diff').length

  // file-only 전체 + 매핑 여부 분류
  const fileOnlyEntries = entries.filter((e) => e.status === 'file-only')
  const fileOnlyExternalCodes = fileOnlyEntries
    .map((e) => (e.status === 'file-only' ? e.row.externalCode : null))
    .filter(Boolean) as string[]

  let mappedFileOnlyCount = 0
  let unmappedFileOnlyCount = 0
  if (fileOnlyExternalCodes.length > 0) {
    const mappings = await prisma.invLocationProductMap.findMany({
      where: { locationId, externalCode: { in: fileOnlyExternalCodes } },
      include: { items: { select: { id: true } } },
    })
    const mappedCodes = new Set(mappings.map((m) => m.externalCode))
    mappedFileOnlyCount = mappings.reduce((acc, m) => acc + m.items.length, 0)
    // 매핑되지 않은 file-only 행도 "미처리 잔여"로 카운트해 APPLIED 전이 차단
    unmappedFileOnlyCount = fileOnlyEntries.filter(
      (e) => e.status === 'file-only' && !mappedCodes.has(e.row.externalCode)
    ).length
  }

  return matchedDiffCount + mappedFileOnlyCount + unmappedFileOnlyCount
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
    if (!mm.externalCode || !mm.items?.length) continue

    // 대응하는 file-only 엔트리 찾기
    const entry = entries.find(
      (e) => e.status === 'file-only' && e.row.externalCode === mm.externalCode
    )
    if (!entry || entry.status !== 'file-only') continue

    // 각 item의 optionId 소유권 검증 (한 번에 조회)
    const validOptions = await prisma.invProductOption.findMany({
      where: {
        id: { in: mm.items.map((i) => i.optionId) },
        product: { spaceId },
      },
      select: { id: true },
    })
    const validOptionIds = new Set(validOptions.map((o) => o.id))

    // Upsert mapping (externalCode 단위)
    const existingMap = await prisma.invLocationProductMap.findUnique({
      where: { locationId_externalCode: { locationId, externalCode: mm.externalCode } },
    })

    let mapId: string
    if (existingMap) {
      // 외부 정보 갱신
      await prisma.invLocationProductMap.update({
        where: { id: existingMap.id },
        data: {
          externalName: entry.row.externalName ?? existingMap.externalName,
          externalOptionName: entry.row.externalOptionName ?? existingMap.externalOptionName,
        },
      })
      mapId = existingMap.id
    } else {
      const created = await prisma.invLocationProductMap.create({
        data: {
          spaceId,
          locationId,
          externalCode: mm.externalCode,
          externalName: entry.row.externalName ?? null,
          externalOptionName: entry.row.externalOptionName ?? null,
        },
      })
      mapId = created.id
    }

    // items 교체: 기존 items 삭제 후 새 items 삽입
    await prisma.invLocationProductMapItem.deleteMany({ where: { mapId } })
    const validItems = mm.items.filter((i) => validOptionIds.has(i.optionId))
    if (validItems.length > 0) {
      await prisma.invLocationProductMapItem.createMany({
        data: validItems.map((i) => ({
          mapId,
          optionId: i.optionId,
          quantity: i.quantity ?? 1,
        })),
      })
    }

    // 선택된 optionId가 items 중 하나라도 포함되면 전체 items 적용
    const itemOptionIds = validItems.map((i) => i.optionId)
    const anySelected = itemOptionIds.some((oid) => options.selectedOptionIds.includes(oid))
    if (anySelected) {
      for (const item of validItems) {
        extraAdjustments.push({
          optionId: item.optionId,
          fileQuantity: entry.row.quantity * (item.quantity ?? 1),
        })
      }
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
      adjustedItems: cumulativeApplied,
    },
  })

  return { adjustedCount: cumulativeApplied, status: newStatus }
}
