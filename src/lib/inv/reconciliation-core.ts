// 재고 대조 코어 — 파싱 이후(소스 무관) 공통 처리.
// route POST(수동 업로드/Deck 연동)와 cron(자동 동기화)이 공유한다.
//
// 입력: ParseResult(파일/Deck 어느 소스든 동일 형태) + locationId(optional)
// 처리: 위치 검증 → 단일/멀티 위치 매칭 → InvReconciliation(PENDING) 생성
// 반환: { reconciliationId, matchResult, primaryLocationId, snapshotDate }

import { prisma } from '@/lib/prisma'
import type { ParseResult, ParsedRow } from '@/lib/inv/reconciliation-parser'
import {
  matchReconciliation,
  type MatchReconciliationResult,
} from '@/lib/inv/reconciliation-matcher'

export class ReconciliationCoreError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export type RunReconciliationMatchResult = {
  reconciliationId: string
  matchResult: MatchReconciliationResult
  primaryLocationId: string
  snapshotDate: Date
  format: string
}

/**
 * 파싱된 결과를 매칭하고 PENDING 대조 기록을 생성한다.
 *
 * @param locationId 단일 위치 매칭 시 지정. null이면 행별 위치명(stock_status_export)으로 분배.
 */
export async function runReconciliationMatch(params: {
  spaceId: string
  parsed: ParseResult
  locationId: string | null
  fileName: string
  snapshotDateOverride?: Date
}): Promise<RunReconciliationMatchResult> {
  const { spaceId, parsed, locationId, fileName, snapshotDateOverride } = params

  const snapshotDate: Date = snapshotDateOverride ?? parsed.snapshotDate ?? new Date()

  let primaryLocationId: string
  let matchResult: MatchReconciliationResult

  // stock_status_export 포맷은 행마다 위치명을 담으므로 항상 멀티 위치 분배.
  const useMultiLocation =
    parsed.format === 'stock_status_export' && parsed.rows.every((r) => !!r.externalLocationName)

  if (locationId && !useMultiLocation) {
    const location = await prisma.invStorageLocation.findFirst({
      where: { id: locationId, spaceId },
      select: { id: true, isActive: true },
    })
    if (!location) throw new ReconciliationCoreError('보관 장소를 찾을 수 없습니다', 404)
    if (!location.isActive) throw new ReconciliationCoreError('보관 장소가 비활성화되었습니다', 400)

    primaryLocationId = location.id
    matchResult = await matchReconciliation(spaceId, location.id, parsed)
  } else {
    const rowsWithoutLoc = parsed.rows.filter((r) => !r.externalLocationName)
    if (rowsWithoutLoc.length > 0) {
      throw new ReconciliationCoreError(
        '파일 행에 위치명이 없습니다. 보관 장소를 선택하거나 위치명 컬럼을 채워 주세요.',
        400
      )
    }

    const locationNames = Array.from(
      new Set(parsed.rows.map((r) => r.externalLocationName as string))
    )
    const locations = await prisma.invStorageLocation.findMany({
      where: { spaceId, name: { in: locationNames } },
      select: { id: true, name: true, isActive: true },
    })
    const locByName = new Map(locations.map((l) => [l.name, l]))

    const unknownNames = locationNames.filter((n) => !locByName.has(n))
    if (unknownNames.length > 0) {
      throw new ReconciliationCoreError(
        `알 수 없는 위치명: ${unknownNames.join(', ')}. 보관 장소 설정을 확인해 주세요.`,
        400
      )
    }
    const inactiveNames = locationNames.filter((n) => {
      const l = locByName.get(n)
      return l && !l.isActive
    })
    if (inactiveNames.length > 0) {
      throw new ReconciliationCoreError(
        `비활성 위치를 포함합니다: ${inactiveNames.join(', ')}`,
        400
      )
    }

    const rowsByLocId = new Map<string, ParsedRow[]>()
    for (const row of parsed.rows) {
      const loc = locByName.get(row.externalLocationName as string)!
      const arr = rowsByLocId.get(loc.id) ?? []
      arr.push(row)
      rowsByLocId.set(loc.id, arr)
    }

    const combinedEntries: MatchReconciliationResult['entries'] = []
    let totalItems = 0
    let matchedItems = 0
    for (const [locId, groupRows] of rowsByLocId) {
      const partial = await matchReconciliation(spaceId, locId, { ...parsed, rows: groupRows })
      combinedEntries.push(...partial.entries)
      totalItems += partial.totalItems
      matchedItems += partial.matchedItems
    }
    matchResult = { entries: combinedEntries, totalItems, matchedItems }

    const firstLocName = parsed.rows[0]?.externalLocationName as string
    primaryLocationId = locByName.get(firstLocName)!.id
  }

  const created = await prisma.invReconciliation.create({
    data: {
      spaceId,
      locationId: primaryLocationId,
      fileName,
      snapshotDate,
      status: 'PENDING',
      matchResults: JSON.parse(JSON.stringify(matchResult.entries)),
      totalItems: matchResult.totalItems,
      matchedItems: matchResult.matchedItems,
      adjustedItems: 0,
    },
  })

  return {
    reconciliationId: created.id,
    matchResult,
    primaryLocationId,
    snapshotDate: created.snapshotDate,
    format: parsed.format,
  }
}
