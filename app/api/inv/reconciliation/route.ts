import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseReconciliationFile } from '@/lib/inv/reconciliation-parser'
import { matchReconciliation } from '@/lib/inv/reconciliation-matcher'

// GET /api/inv/reconciliation — 히스토리 목록
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
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

// POST /api/inv/reconciliation — 파일 업로드 → 파싱 → 매칭 → PENDING 생성
// multipart/form-data: file, locationId, snapshotDate?
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return errorResponse('multipart/form-data가 필요합니다', 400)
  }

  const file = form.get('file')
  const locationId = form.get('locationId')
  const snapshotDateRaw = form.get('snapshotDate')

  if (!(file instanceof File)) return errorResponse('file 이 필요합니다', 400)
  if (typeof locationId !== 'string' || !locationId) {
    return errorResponse('locationId 가 필요합니다', 400)
  }

  const location = await prisma.invStorageLocation.findFirst({
    where: { id: locationId, spaceId: resolved.space.id },
    select: { id: true, isActive: true },
  })
  if (!location) return errorResponse('보관 장소를 찾을 수 없습니다', 404)
  if (!location.isActive) return errorResponse('보관 장소가 비활성화되었습니다', 400)

  const buffer = await file.arrayBuffer()

  let parsed
  try {
    parsed = parseReconciliationFile(buffer, file.name)
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : '파일 파싱 실패',
      400
    )
  }

  let snapshotDate: Date
  if (typeof snapshotDateRaw === 'string' && snapshotDateRaw) {
    const d = new Date(snapshotDateRaw)
    if (Number.isNaN(d.getTime())) {
      return errorResponse('snapshotDate 가 유효하지 않습니다', 400)
    }
    snapshotDate = d
  } else if (parsed.snapshotDate) {
    snapshotDate = parsed.snapshotDate
  } else {
    snapshotDate = new Date()
  }

  let matchResult
  try {
    matchResult = await matchReconciliation(
      resolved.space.id,
      locationId,
      parsed
    )
  } catch (err) {
    console.error('[reconciliation POST] match 실패', err)
    return errorResponse('매칭 처리에 실패했습니다', 500)
  }

  const created = await prisma.invReconciliation.create({
    data: {
      spaceId: resolved.space.id,
      locationId,
      fileName: file.name,
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
