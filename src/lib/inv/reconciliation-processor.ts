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
  /**
   * system-only(외부 스냅샷에 없는데 해당 위치에 재고가 남은 옵션)를 0 으로 내린다.
   *
   * 기본 false — 수동 대조는 기존 동작(무시)을 유지한다. 자동 대조 cron 만 켠다.
   * 켤 때 호출측 책임: 스냅샷 완전성 확인 + file-only(미매핑) 0건 확인.
   * 미매핑 외부 SKU 가 남아 있으면 "스냅샷에 없음"이 실제 0 이 아니라 매핑 누락일 수
   * 있어, 살아있는 재고를 0 으로 죽인다.
   */
  includeSystemOnly?: boolean
}

export type ConfirmResult = {
  adjustedCount: number
  status: string
  /** best-effort 루프에서 실패한 항목 목록. 성공 시 undefined 또는 빈 배열. */
  failed?: { optionId: string; locationId: string; reason: string }[]
  /**
   * includeSystemOnly 를 켰지만 매핑이 없어 0 처리하지 않은 건수.
   * 사용자에게 "쿠팡 SKU 연결이 필요하다"고 안내할 대상.
   */
  unmappedSystemOnly?: number
}

/**
 * system-only 엔트리 중 InvLocationProductMap 매핑이 있는 것의 키(`${locationId}|${optionId}`)를 모은다.
 *
 * 매핑이 없는 system-only 는 "쿠팡에서 소진됨"인지 "애초에 연동 안 된 옵션"인지 구별할 수 없다.
 * (외부 코드가 없으니 file-only 짝도 생기지 않아 file-only 0건 검사로도 걸러지지 않는다.)
 * → 자동 0 처리 대상에서 제외하고 사용자에게 매핑을 요구한다.
 */
export async function findMappedSystemOnlyKeys(
  entries: MatchEntry[],
  reconLocationId: string
): Promise<Set<string>> {
  const systemOnly = entries.filter(
    (e): e is Extract<MatchEntry, { status: 'system-only' }> => e.status === 'system-only'
  )
  if (systemOnly.length === 0) return new Set()

  const optionIds = Array.from(new Set(systemOnly.map((e) => e.optionId)))
  const locationIds = Array.from(
    new Set(systemOnly.map((e) => e.locationId ?? reconLocationId))
  )

  const items = await prisma.invLocationProductMapItem.findMany({
    where: { optionId: { in: optionIds }, map: { locationId: { in: locationIds } } },
    select: { optionId: true, map: { select: { locationId: true } } },
  })

  return new Set(items.map((i) => `${i.map.locationId}|${i.optionId}`))
}

/**
 * 적용 가능한 총 항목 수를 산출한다.
 * matched-diff entry 수 + file-only 중 InvLocationProductMap에 매핑된 items 수
 */
async function calcApplicableCount(
  entries: MatchEntry[],
  reconLocationId: string,
  includeSystemOnly = false
): Promise<number> {
  // matched-diff 항목 수
  const matchedDiffCount = entries.filter((e) => e.status === 'matched-diff').length

  // system-only 0 반영을 켰으면 그 건수도 분모에 포함 — 빠뜨리면 APPLIED/PARTIAL 판정이
  // 틀린 총계로 계산돼 이미 다 적용된 대조가 영영 PARTIAL 로 남는다.
  // 매핑 없는 건은 적용되지 않지만 분모에는 남긴다(file-only 미매핑과 동일) — PARTIAL 로
  // 유지돼 "매핑 필요"가 목록에서 표면화된다.
  const systemOnlyCount = includeSystemOnly
    ? entries.filter((e) => e.status === 'system-only').length
    : 0

  // file-only 전체 + 매핑 여부 분류 — 위치별 그룹핑(멀티 location 대응)
  const fileOnlyEntries = entries.filter(
    (e): e is Extract<MatchEntry, { status: 'file-only' }> => e.status === 'file-only'
  )
  if (fileOnlyEntries.length === 0) return matchedDiffCount + systemOnlyCount

  // locationId별로 externalCode 그룹핑
  const codesByLocId = new Map<string, string[]>()
  for (const e of fileOnlyEntries) {
    const code = e.row.externalCode
    if (!code) continue
    const locId = e.locationId ?? reconLocationId
    const arr = codesByLocId.get(locId) ?? []
    arr.push(code)
    codesByLocId.set(locId, arr)
  }

  let mappedFileOnlyCount = 0
  const mappedKeys = new Set<string>() // `${locId}|${code}`
  for (const [locId, codes] of codesByLocId) {
    if (codes.length === 0) continue
    const mappings = await prisma.invLocationProductMap.findMany({
      where: { locationId: locId, externalCode: { in: codes } },
      include: { items: { select: { id: true } } },
    })
    for (const m of mappings) {
      mappedFileOnlyCount += m.items.length
      mappedKeys.add(`${locId}|${m.externalCode}`)
    }
  }

  const unmappedFileOnlyCount = fileOnlyEntries.filter((e) => {
    const code = e.row.externalCode
    if (!code) return true // externalCode 없는 file-only는 매핑 불가 → 미처리 잔여
    const locId = e.locationId ?? reconLocationId
    return !mappedKeys.has(`${locId}|${code}`)
  }).length

  return matchedDiffCount + systemOnlyCount + mappedFileOnlyCount + unmappedFileOnlyCount
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
  const { locationId: reconLocationId, snapshotDate, fileName } = recon

  // 1) 수동 매핑 upsert + 해당 file-only 항목을 adjustment 후보로 변환
  const extraAdjustments: {
    optionId: string
    locationId: string
    fileQuantity: number
  }[] = []

  for (const mm of options.manualMappings) {
    if (!mm.externalCode || !mm.items?.length) continue

    // 대응하는 file-only 엔트리 찾기
    const entry = entries.find(
      (e) => e.status === 'file-only' && e.row.externalCode === mm.externalCode
    )
    if (!entry || entry.status !== 'file-only') continue

    // entry 자체의 locationId 우선 (멀티 location 파일 대응)
    const entryLocationId = entry.locationId ?? reconLocationId

    // 각 item의 optionId 소유권 검증 (한 번에 조회)
    const validOptions = await prisma.invProductOption.findMany({
      where: {
        id: { in: mm.items.map((i) => i.optionId) },
        product: { spaceId },
      },
      select: { id: true },
    })
    const validOptionIds = new Set(validOptions.map((o) => o.id))

    // Upsert mapping (externalCode 단위) — entry의 locationId 사용
    const existingMap = await prisma.invLocationProductMap.findUnique({
      where: {
        locationId_externalCode: { locationId: entryLocationId, externalCode: mm.externalCode },
      },
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
          locationId: entryLocationId,
          externalCode: mm.externalCode,
          externalName: entry.row.externalName ?? null,
          externalOptionName: entry.row.externalOptionName ?? null,
        },
      })
      mapId = created.id
    }

    // items 교체: deleteMany + createMany를 배열형 트랜잭션으로 원자화
    // — deleteMany 성공 후 createMany 실패 시 items 소실을 방지한다.
    const validItems = mm.items.filter((i) => validOptionIds.has(i.optionId))
    await prisma.$transaction([
      prisma.invLocationProductMapItem.deleteMany({ where: { mapId } }),
      ...(validItems.length > 0
        ? [
            prisma.invLocationProductMapItem.createMany({
              data: validItems.map((i) => ({
                mapId,
                optionId: i.optionId,
                quantity: i.quantity ?? 1,
              })),
            }),
          ]
        : []),
    ])

    // 선택된 optionId가 items 중 하나라도 포함되면 전체 items 적용
    const itemOptionIds = validItems.map((i) => i.optionId)
    const anySelected = itemOptionIds.some((oid) => options.selectedOptionIds.includes(oid))
    if (anySelected) {
      for (const item of validItems) {
        extraAdjustments.push({
          optionId: item.optionId,
          locationId: entryLocationId,
          fileQuantity: entry.row.quantity * (item.quantity ?? 1),
        })
      }
    }
  }

  // 2) matched-diff 중 선택된 항목 adjustment — entry.locationId 우선
  const selected = new Set(options.selectedOptionIds)
  const diffAdjustments: { optionId: string; locationId: string; fileQuantity: number }[] = []
  for (const e of entries) {
    if (e.status !== 'matched-diff') continue
    if (!selected.has(e.optionId)) continue
    diffAdjustments.push({
      optionId: e.optionId,
      locationId: e.locationId ?? reconLocationId,
      fileQuantity: e.fileQuantity,
    })
  }

  // 2.5) system-only → 0 반영 (옵션. 자동 대조 cron 전용)
  //  외부 스냅샷이 authoritative 라는 전제에서만 성립한다. 미매핑(file-only) 이 있으면
  //  "스냅샷에 없음"이 매핑 누락일 수 있으므로 호출측이 켜지 않아야 한다.
  const systemOnlyAdjustments: { optionId: string; locationId: string; fileQuantity: number }[] = []
  let unmappedSystemOnlyCount = 0
  if (options.includeSystemOnly) {
    // 같은 (location, option) 이 앞 단계에서 이미 수량 조정 대상이면 0 으로 덮지 않는다.
    // (사후 수동 매핑으로 file-only 가 system-only 와 같은 옵션을 가리키게 된 경우)
    const alreadyTargeted = new Set(
      [...diffAdjustments, ...extraAdjustments].map((a) => `${a.locationId}|${a.optionId}`)
    )
    // 매핑 있는 것만 0 처리 — 매핑 없는 건 소진인지 미연동인지 알 수 없다.
    const mappedKeys = await findMappedSystemOnlyKeys(entries, reconLocationId)
    for (const e of entries) {
      if (e.status !== 'system-only') continue
      const locId = e.locationId ?? reconLocationId
      const key = `${locId}|${e.optionId}`
      if (alreadyTargeted.has(key)) continue
      if (!mappedKeys.has(key)) {
        unmappedSystemOnlyCount += 1
        continue
      }
      systemOnlyAdjustments.push({ optionId: e.optionId, locationId: locId, fileQuantity: 0 })
    }
  }

  const all = [...diffAdjustments, ...extraAdjustments, ...systemOnlyAdjustments]
  const systemOnlyKeys = new Set(
    systemOnlyAdjustments.map((a) => `${a.locationId}|${a.optionId}`)
  )
  const movementDate = snapshotDate.toISOString()
  const snapshotStr = snapshotDate.toISOString().slice(0, 10)

  // 수정 3: PARTIAL 재시도 시 이미 적용된 (optionId, locationId) 건을 재조회해 건너뜀.
  // — ADJUSTMENT는 절대량(스냅샷 fileQuantity) set이라, 재적용 시 중간 INBOUND/OUTBOUND를
  //   스냅샷 값으로 덮어쓰는 무음 재고 손상이 발생한다.
  // 주의: 동시 최초 확정 2건(더블클릭)은 둘 다 빈 set을 보는 sub-second 창이 남는다.
  //       processMovement 내부 advisory lock이 중첩 tx를 감쌀 수 없어 미수정 사항.
  //       단, ADJUSTMENT는 절대량 set이라 멱등성이 있어 재고 손상은 없다.
  const preApplied = await prisma.invMovement.findMany({
    where: { referenceId: reconciliationId, type: 'ADJUSTMENT' },
    select: { optionId: true, locationId: true },
  })
  const preAppliedKeys = new Set(preApplied.map((m) => `${m.locationId}|${m.optionId}`))

  // 실패 항목 추적 — best-effort는 유지하되(첫 실패에 throw 금지) 실패를 표면화
  const failed: { optionId: string; locationId: string; reason: string }[] = []

  for (const adj of all) {
    // 이미 적용된 건 건너뜀 — 재적용 금지
    if (preAppliedKeys.has(`${adj.locationId}|${adj.optionId}`)) continue

    try {
      await processMovement(spaceId, {
        type: 'ADJUSTMENT',
        optionId: adj.optionId,
        locationId: adj.locationId,
        quantity: adj.fileQuantity,
        movementDate,
        reason: systemOnlyKeys.has(`${adj.locationId}|${adj.optionId}`)
          ? `파일 대조 조정 — 외부 스냅샷 미존재로 0 처리 (${snapshotStr} 기준, 파일: ${fileName})`
          : `파일 대조 조정 (${snapshotStr} 기준, 파일: ${fileName})`,
        referenceId: reconciliationId,
      })
    } catch (err) {
      console.error('[confirmReconciliation] adjustment 실패', adj, err)
      failed.push({
        optionId: adj.optionId,
        locationId: adj.locationId,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 3) 누적 적용 항목 수 — DB에서 직접 집계 (retry 시 drift 방지)
  // 멀티 location 대응: optionId+locationId 조합으로 distinct
  const appliedMovements = await prisma.invMovement.findMany({
    where: { referenceId: reconciliationId, type: 'ADJUSTMENT' },
    select: { optionId: true, locationId: true },
  })
  const appliedKeys = new Set(appliedMovements.map((m) => `${m.locationId}|${m.optionId}`))
  const cumulativeApplied = appliedKeys.size

  // 4) 적용 가능 총수 산출
  const applicableTotal = await calcApplicableCount(
    entries,
    reconLocationId,
    options.includeSystemOnly
  )

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

  return {
    adjustedCount: cumulativeApplied,
    status: newStatus,
    ...(failed.length ? { failed } : {}),
    ...(unmappedSystemOnlyCount > 0 ? { unmappedSystemOnly: unmappedSystemOnlyCount } : {}),
  }
}
