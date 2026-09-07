// 재고 대조 코어 — 파싱 이후(소스 무관) 공통 처리.
// route POST(수동 업로드/Deck 연동)와 cron(자동 동기화)이 공유한다.
//
// 입력: ParseResult(파일/Deck 어느 소스든 동일 형태) + locationId(optional)
// 처리: 위치 검증 → 단일/멀티 위치 매칭 → InvReconciliation(PENDING) 생성
// 반환: { reconciliationId, matchResult, primaryLocationId, snapshotDate }

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from './external-sources'
import type { ParseResult, ParsedRow } from '@/lib/inv/reconciliation-parser'
import {
  matchReconciliation,
  type MatchReconciliationResult,
} from '@/lib/inv/reconciliation-matcher'

// code: 클라이언트가 메시지 문자열을 파싱하지 않고 분기하기 위한 식별자.
// details: 사용자가 스스로 고칠 수 있도록 화면에 그대로 보여줄 부가 정보.
export type ReconciliationErrorCode =
  | 'LOCATION_REQUIRED'
  | 'LOCATION_UNKNOWN'
  | 'LOCATION_INACTIVE'
  | 'LOCATION_NOT_FOUND'

export class ReconciliationCoreError extends Error {
  status: number
  code?: ReconciliationErrorCode
  details?: Record<string, unknown>
  constructor(
    message: string,
    status = 400,
    opts?: { code?: ReconciliationErrorCode; details?: Record<string, unknown> }
  ) {
    super(message)
    this.status = status
    this.code = opts?.code
    this.details = opts?.details
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
    if (!location)
      throw new ReconciliationCoreError('보관 장소를 찾을 수 없습니다', 404, {
        code: 'LOCATION_NOT_FOUND',
      })
    if (!location.isActive)
      throw new ReconciliationCoreError('보관 장소가 비활성화되었습니다', 400, {
        code: 'LOCATION_INACTIVE',
      })

    primaryLocationId = location.id
    matchResult = await matchReconciliation(spaceId, location.id, parsed)
  } else {
    const rowsWithoutLoc = parsed.rows.filter((r) => !r.externalLocationName)
    if (rowsWithoutLoc.length > 0) {
      const activeLocations = await prisma.invStorageLocation.findMany({
        where: { spaceId, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      })
      throw new ReconciliationCoreError(
        `위치명이 비어있는 행이 ${rowsWithoutLoc.length}건 있습니다 (전체 ${parsed.rows.length}건). ` +
          '보관 장소를 선택하면 그 장소 재고로 반영합니다.',
        400,
        {
          code: 'LOCATION_REQUIRED',
          details: {
            missingCount: rowsWithoutLoc.length,
            totalRows: parsed.rows.length,
            locationNames: activeLocations.map((l) => l.name),
          },
        }
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
      // 안내에 쓰는 목록은 파일에 등장한 이름이 아니라 워크스페이스의 활성 장소 전체다.
      const activeLocations = await prisma.invStorageLocation.findMany({
        where: { spaceId, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      })
      throw new ReconciliationCoreError(
        `파일의 위치명 ${unknownNames.join(', ')} 이(가) 보관 장소에 없습니다. ` +
          `사용 가능한 보관 장소: ${activeLocations.map((l) => l.name).join(', ')}. ` +
          '파일의 위치명을 맞추거나 보관 장소를 추가해 주세요.',
        400,
        {
          code: 'LOCATION_UNKNOWN',
          details: { unknownNames, locationNames: activeLocations.map((l) => l.name) },
        }
      )
    }
    const inactiveNames = locationNames.filter((n) => {
      const l = locByName.get(n)
      return l && !l.isActive
    })
    if (inactiveNames.length > 0) {
      throw new ReconciliationCoreError(
        `비활성 보관 장소를 포함합니다: ${inactiveNames.join(', ')}. 해당 장소를 다시 활성화하거나 파일에서 제외해 주세요.`,
        400,
        { code: 'LOCATION_INACTIVE', details: { inactiveNames } }
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

  // 로켓그로스 연동 위치는 열린 대조를 최신 1건만 유지한다(아래 함수 주석 참조).
  await cancelSupersededRocketGrowthReconciliations({
    spaceId,
    locationId: primaryLocationId,
    keepId: created.id,
    keepSnapshotDate: created.snapshotDate,
  })

  return {
    reconciliationId: created.id,
    matchResult,
    primaryLocationId,
    snapshotDate: created.snapshotDate,
    format: parsed.format,
  }
}

/**
 * 쿠팡 로켓그로스 연동 위치에서, 최신 스냅샷보다 오래된 **미확정** 대조를 CANCELLED 로 내린다.
 *
 * 왜 필요한가: 대조 확정은 절대량 set 이다. 며칠 지난 스냅샷을 뒤늦게 확정하면 그 사이의
 * 입출고가 옛 실재고로 조용히 덮어써진다. 낡은 미확정 대조를 목록에 남겨두는 건 어지러운
 * 정도의 문제가 아니라 재고 손상 경로다. 항상 최신 1건만 열어 둔다.
 *
 * 왜 hard delete 가 아니라 CANCELLED 인가: cron 의 멱등 skip 마커가 CANCELLED 도 인정한다.
 * 행을 지우면 같은 스냅샷으로 새 대조가 만들어지고, referenceId 가 달라 재적용 가드
 * (confirmReconciliation 의 preApplied)가 무력화된다. 사용자 삭제(DELETE 라우트)도 적용
 * 이력이 있으면 같은 처리를 한다.
 *
 * strict `<` 인 이유: 파일명으로 자동/수동을 가르지 않고 스냅샷 날짜로 자른다. 며칠치
 * 누적은 전부 정리되면서, **같은 날짜의 수동 업로드 세션은 그날 죽지 않는다**. 그리고
 * keepSnapshotDate 보다 나중 스냅샷은 조건상 절대 취소되지 않으므로 "최신 마커를
 * 취소하면 안 된다"는 가드가 조건식 자체로 보장된다.
 *
 * keepId/keepSnapshotDate 를 호출측이 명시한다 — 함수가 스스로 "최신"을 찾으면 cron 의
 * skip 분기(정렬 없는 findFirst)와 판단이 갈린다.
 */
export async function cancelSupersededRocketGrowthReconciliations(params: {
  spaceId: string
  locationId: string
  keepId: string
  keepSnapshotDate: Date
}): Promise<number> {
  const loc = await prisma.invStorageLocation.findFirst({
    where: {
      id: params.locationId,
      spaceId: params.spaceId,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
    },
    select: { id: true },
  })
  // 로켓그로스 연동 위치가 아니면 아무것도 하지 않는다 — 일반 위치의 대조 이력은 사용자 자산이다.
  if (!loc) return 0

  const result = await prisma.invReconciliation.updateMany({
    where: {
      spaceId: params.spaceId,
      locationId: params.locationId,
      status: { in: ['PENDING', 'PARTIAL'] },
      id: { not: params.keepId },
      snapshotDate: { lt: params.keepSnapshotDate },
    },
    data: { status: 'CANCELLED' },
  })
  if (result.count > 0) {
    console.log(
      `[reconciliation] space ${params.spaceId} / location ${params.locationId}: ` +
        `낡은 로켓그로스 미확정 대조 ${result.count}건 정리`
    )
  }
  return result.count
}
