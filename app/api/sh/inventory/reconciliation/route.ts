import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseReconciliationFile, type ParseResult } from '@/lib/inv/reconciliation-parser'
import { getCoupangInventoryRows } from '@/lib/inv/reconciliation-sources'
import { runReconciliationMatch, ReconciliationCoreError } from '@/lib/inv/reconciliation-core'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { ensureCoupangSalesChannel } from '@/lib/inv/coupang-channel-pairing'

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

      // 자동 동기화 cron이 워크스페이스를 결정적으로 해석할 수 있도록, 로켓그로스
      // 위치의 externalIntegrationKey 에 페어 workspaceId 를 1회 backfill 한다.
      if (locationId) {
        await prisma.invStorageLocation
          .updateMany({
            where: {
              id: locationId,
              spaceId: resolved.space.id,
              externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
              externalIntegrationKey: null,
            },
            data: { externalIntegrationKey: workspace.id },
          })
          .catch((err) => {
            // backfill 실패 시 cron 의 자동 동기화가 영구 skip 되므로 최소한 로그.
            console.warn('[reconciliation POST] externalIntegrationKey backfill 실패', err)
          })
      }

      // 1:1 페어링 — 위치 연동 시 로켓 판매채널이 없으면 자동 생성(판매 OUTBOUND 귀속용).
      await ensureCoupangSalesChannel(resolved.space.id).catch((err) =>
        console.warn('[reconciliation POST] 로켓 판매채널 페어링 실패', err)
      )

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

  // ── 공통 코어: location 검증 → 매칭 → PENDING 생성 (cron 과 공유) ──
  let core
  try {
    core = await runReconciliationMatch({
      spaceId: resolved.space.id,
      parsed,
      locationId,
      fileName,
      snapshotDateOverride,
    })
  } catch (err) {
    if (err instanceof ReconciliationCoreError) return errorResponse(err.message, err.status)
    console.error('[reconciliation POST] match 실패', err)
    return errorResponse('매칭 처리에 실패했습니다', 500)
  }

  return NextResponse.json({
    id: core.reconciliationId,
    fileName,
    format: core.format,
    snapshotDate: core.snapshotDate,
    totalItems: core.matchResult.totalItems,
    matchedItems: core.matchResult.matchedItems,
    matchResults: core.matchResult.entries,
  })
}
