import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseReconciliationFile, type ParseResult } from '@/lib/inv/reconciliation-parser'
import { matchReconciliation } from '@/lib/inv/reconciliation-matcher'
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

  // ── 입력 소스 해석: parsed(ParseResult) + locationId + fileName + snapshotDate override ──
  let parsed: ParseResult
  let locationId: string
  let fileName: string
  let snapshotDateOverride: Date | undefined

  if (isJson) {
    let body: { source?: string; locationId?: string; snapshotDate?: string }
    try {
      body = await req.json()
    } catch {
      return errorResponse('JSON 본문이 필요합니다', 400)
    }

    if (typeof body.locationId !== 'string' || !body.locationId) {
      return errorResponse('locationId 가 필요합니다', 400)
    }
    locationId = body.locationId

    if (typeof body.snapshotDate === 'string' && body.snapshotDate) {
      const d = new Date(body.snapshotDate)
      if (Number.isNaN(d.getTime())) {
        return errorResponse('snapshotDate 가 유효하지 않습니다', 400)
      }
      snapshotDateOverride = d
    }

    if (body.source === 'coupang') {
      // Workspace ↔ Space 직접 연결이 없으므로 현재 유저의 쿠팡 Workspace 경유
      const workspace = await prisma.workspace.findUnique({
        where: { ownerId: resolved.user.id },
        select: { id: true },
      })
      if (!workspace) {
        return errorResponse('연결된 쿠팡 워크스페이스를 찾을 수 없습니다', 404)
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
        return errorResponse('연동할 쿠팡 재고 데이터가 없습니다', 400)
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
    if (typeof locationIdRaw !== 'string' || !locationIdRaw) {
      return errorResponse('locationId 가 필요합니다', 400)
    }
    locationId = locationIdRaw
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

  // ── 공통: location 검증 → 매칭 → PENDING 생성 (소스 무관) ──
  const location = await prisma.invStorageLocation.findFirst({
    where: { id: locationId, spaceId: resolved.space.id },
    select: { id: true, isActive: true },
  })
  if (!location) return errorResponse('보관 장소를 찾을 수 없습니다', 404)
  if (!location.isActive) return errorResponse('보관 장소가 비활성화되었습니다', 400)

  const snapshotDate: Date = snapshotDateOverride ?? parsed.snapshotDate ?? new Date()

  let matchResult
  try {
    matchResult = await matchReconciliation(resolved.space.id, locationId, parsed)
  } catch (err) {
    console.error('[reconciliation POST] match 실패', err)
    return errorResponse('매칭 처리에 실패했습니다', 500)
  }

  const created = await prisma.invReconciliation.create({
    data: {
      spaceId: resolved.space.id,
      locationId,
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
