import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  parseReconciliationFile,
  type ParseResult,
  type ParsedRow,
} from '@/lib/inv/reconciliation-parser'
import {
  matchReconciliation,
  type MatchReconciliationResult,
} from '@/lib/inv/reconciliation-matcher'
import { getCoupangInventoryRows } from '@/lib/inv/reconciliation-sources'

// GET /api/inv/reconciliation — 히스토리 목록
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))

  const [data, total] = await Promise.all([
    prisma.invReconciliation.findMany({
      where: { spaceId: resolved.space.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { location: { select: { id: true, name: true } } },
    }),
    prisma.invReconciliation.count({ where: { spaceId: resolved.space.id } }),
  ])

  // matchResults 는 목록에서는 제외 (용량 큼)
  const list = data.map(({ matchResults: _mr, ...rest }) => rest)
  return NextResponse.json({ data: list, total, page, pageSize })
}

// POST /api/inv/reconciliation — 데이터 소스 → 파싱 → 매칭 → PENDING 생성
// - multipart/form-data: file, locationId, snapshotDate?           (파일 업로드)
// - application/json: { source: 'coupang', locationId, snapshotDate? } (Deck 연동)
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const contentType = req.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')

  // ── 입력 소스 해석: parsed(ParseResult) + locationId(optional) + fileName + snapshotDate override ──
  let parsed: ParseResult
  // locationId가 없으면 파일이 위치명 정보를 들고 있다는 뜻 → 행별 분배
  let locationId: string | null = null
  let fileName: string
  let snapshotDateOverride: Date | undefined

  if (isJson) {
    let body: { source?: string; locationId?: string; snapshotDate?: string }
    try {
      body = await req.json()
    } catch {
      return errorResponse('JSON 본문이 필요합니다', 400)
    }

    if (typeof body.locationId === 'string' && body.locationId) {
      locationId = body.locationId
    }

    if (typeof body.snapshotDate === 'string' && body.snapshotDate) {
      const d = new Date(body.snapshotDate)
      if (Number.isNaN(d.getTime())) {
        return errorResponse('snapshotDate 가 유효하지 않습니다', 400)
      }
      snapshotDateOverride = d
    }

    if (body.source === 'coupang') {
      // locationId 미지정 시 externalSource로 자동 매핑된 위치를 사용
      if (!locationId) {
        const mapped = await prisma.invStorageLocation.findFirst({
          where: {
            spaceId: resolved.space.id,
            externalSource: 'coupang_rocket_growth',
            isActive: true,
          },
          select: { id: true },
        })
        if (!mapped) {
          return errorResponse(
            "쿠팡 로켓그로스 위치가 등록되지 않았습니다. 위치 관리에서 '연결된 소스 = 쿠팡 로켓그로스' 위치를 추가해 주세요.",
            400
          )
        }
        locationId = mapped.id
      }

      // Workspace ↔ Space 직접 연결이 없으므로 현재 유저의 쿠팡 Workspace 경유
      const workspace = await prisma.workspace.findUnique({
        where: { ownerId: resolved.user.id },
        select: { id: true },
      })
      if (!workspace) {
        return errorResponse(
          '쿠팡 광고 관리자에 연결된 워크스페이스가 없습니다. 쿠팡 광고 관리자 Deck에서 크레덴셜을 등록한 뒤 다시 시도해 주세요.',
          404
        )
      }

      try {
        parsed = await getCoupangInventoryRows(workspace.id, {
          snapshotDate: snapshotDateOverride,
        })
      } catch (err) {
        console.error('[reconciliation POST] coupang 소스 조회 실패', err)
        return errorResponse('쿠팡 재고 데이터를 불러오지 못했습니다', 500)
      }

      if (parsed.rows.length === 0) {
        const hint = snapshotDateOverride
          ? `${snapshotDateOverride.toISOString().slice(0, 10)} 자에 수집된 스냅샷이 없습니다. 다른 기준일을 선택하거나, 기준일을 비워 가장 최근 스냅샷을 사용하세요.`
          : '쿠팡 광고 관리자 Deck에서 재고 수집이 한 번 이상 실행됐는지 확인해 주세요.'
        return errorResponse(`연동할 쿠팡 재고 스냅샷이 없습니다. ${hint}`, 400)
      }

      const sd = parsed.snapshotDate
      fileName = `쿠팡 로켓그로스 재고${sd ? ` (스냅샷 ${sd.toISOString().slice(0, 10)})` : ''}`
    } else {
      return errorResponse('지원하지 않는 연동 소스입니다', 400)
    }
  } else {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return errorResponse('multipart/form-data가 필요합니다', 400)
    }

    const file = form.get('file')
    const locationIdRaw = form.get('locationId')
    const snapshotDateRaw = form.get('snapshotDate')

    if (!(file instanceof File)) return errorResponse('file 이 필요합니다', 400)
    if (typeof locationIdRaw === 'string' && locationIdRaw) {
      locationId = locationIdRaw
    }
    fileName = file.name

    if (typeof snapshotDateRaw === 'string' && snapshotDateRaw) {
      const d = new Date(snapshotDateRaw)
      if (Number.isNaN(d.getTime())) {
        return errorResponse('snapshotDate 가 유효하지 않습니다', 400)
      }
      snapshotDateOverride = d
    }

    const buffer = await file.arrayBuffer()
    try {
      parsed = parseReconciliationFile(buffer, file.name)
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : '파일 파싱 실패', 400)
    }
  }

  // ── 공통: location 검증 → 매칭 → PENDING 생성 ──
  // locationId가 주어진 경우: 단일 location 매칭
  // 주어지지 않은 경우: 파일 행의 externalLocationName으로 그룹핑하여 위치별 매칭
  const snapshotDate: Date = snapshotDateOverride ?? parsed.snapshotDate ?? new Date()

  let primaryLocationId: string
  let matchResult: MatchReconciliationResult

  // stock_status_export 포맷은 행마다 위치명을 담고 있으므로 서버가 항상 멀티 위치 분배로 처리한다.
  // (클라이언트가 단일 locationId를 보냈더라도 무시.)
  const useMultiLocation =
    parsed.format === 'stock_status_export' && parsed.rows.every((r) => !!r.externalLocationName)

  try {
    if (locationId && !useMultiLocation) {
      const location = await prisma.invStorageLocation.findFirst({
        where: { id: locationId, spaceId: resolved.space.id },
        select: { id: true, isActive: true },
      })
      if (!location) return errorResponse('보관 장소를 찾을 수 없습니다', 404)
      if (!location.isActive) return errorResponse('보관 장소가 비활성화되었습니다', 400)

      primaryLocationId = location.id
      matchResult = await matchReconciliation(resolved.space.id, location.id, parsed)
    } else {
      // 멀티 위치 분배 — 모든 행에 externalLocationName이 있어야 함
      const rowsWithoutLoc = parsed.rows.filter((r) => !r.externalLocationName)
      if (rowsWithoutLoc.length > 0) {
        return errorResponse(
          '파일 행에 위치명이 없습니다. 보관 장소를 선택하거나 위치명 컬럼을 채워 주세요.',
          400
        )
      }

      const locationNames = Array.from(
        new Set(parsed.rows.map((r) => r.externalLocationName as string))
      )
      const locations = await prisma.invStorageLocation.findMany({
        where: { spaceId: resolved.space.id, name: { in: locationNames } },
        select: { id: true, name: true, isActive: true },
      })
      const locByName = new Map(locations.map((l) => [l.name, l]))

      const unknownNames = locationNames.filter((n) => !locByName.has(n))
      if (unknownNames.length > 0) {
        return errorResponse(
          `알 수 없는 위치명: ${unknownNames.join(', ')}. 보관 장소 설정을 확인해 주세요.`,
          400
        )
      }
      const inactiveNames = locationNames.filter((n) => {
        const l = locByName.get(n)
        return l && !l.isActive
      })
      if (inactiveNames.length > 0) {
        return errorResponse(`비활성 위치를 포함합니다: ${inactiveNames.join(', ')}`, 400)
      }

      // 위치별 그룹핑하여 매칭 실행
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
        const partial = await matchReconciliation(resolved.space.id, locId, {
          ...parsed,
          rows: groupRows,
        })
        combinedEntries.push(...partial.entries)
        totalItems += partial.totalItems
        matchedItems += partial.matchedItems
      }
      matchResult = { entries: combinedEntries, totalItems, matchedItems }

      // 다중 위치이므로 대표 location은 가장 행이 많은 위치 사용 (DB FK 위해 필수)
      const firstLocName = parsed.rows[0]?.externalLocationName as string
      primaryLocationId = locByName.get(firstLocName)!.id
    }
  } catch (err) {
    console.error('[reconciliation POST] match 실패', err)
    return errorResponse('매칭 처리에 실패했습니다', 500)
  }

  const created = await prisma.invReconciliation.create({
    data: {
      spaceId: resolved.space.id,
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

  return NextResponse.json({
    id: created.id,
    fileName: created.fileName,
    format: parsed.format,
    snapshotDate: created.snapshotDate,
    totalItems: created.totalItems,
    matchedItems: created.matchedItems,
    matchResults: matchResult.entries,
  })
}
