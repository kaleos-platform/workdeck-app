import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { trackMeterEvent } from '@/lib/meter'
import { createClient } from '@/lib/supabase/server'
import {
  parseExcelBuffer,
  parseCsvBuffer,
  detectPeriod,
  ColumnValidationError,
} from '@/lib/excel-parser'
import type { ParsedRow } from '@/lib/excel-parser'

type UploadRequestBody = {
  storagePath: string
  fileName: string
}

export const runtime = 'nodejs'

function parseUploadBody(body: unknown): UploadRequestBody | null {
  if (typeof body !== 'object' || body === null) return null

  const storagePath =
    'storagePath' in body && typeof body.storagePath === 'string' ? body.storagePath.trim() : ''
  const fileName =
    'fileName' in body && typeof body.fileName === 'string' ? body.fileName.trim() : ''

  if (!storagePath || !fileName) return null
  return { storagePath, fileName }
}

// POST /api/reports/upload — JSON body { storagePath, fileName }
// 브라우저가 Supabase Storage에 직접 업로드한 파일을 서버에서 다운로드 후 파싱·저장
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { user, workspace } = resolved

  // overwrite 쿼리 파라미터: null(첫 요청), 'true'(덮어쓰기), 'false'(중복 스킵)
  const url = new URL(request.url)
  const overwrite = url.searchParams.get('overwrite')

  // JSON body 파싱
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return errorResponse('요청 형식이 올바르지 않습니다. JSON 본문으로 요청해주세요', 415)
  }

  let parsedBody: UploadRequestBody | null = null
  try {
    const body = await request.json()
    parsedBody = parseUploadBody(body)
  } catch {
    return errorResponse('storagePath와 fileName이 필요합니다', 400)
  }
  if (!parsedBody) return errorResponse('storagePath와 fileName이 필요합니다', 400)
  const { storagePath, fileName } = parsedBody

  // 허용 확장자: .xlsx, .csv
  const isXlsx = fileName.endsWith('.xlsx')
  const isCsv = fileName.endsWith('.csv')
  if (!isXlsx && !isCsv) {
    return errorResponse('.xlsx 또는 .csv 파일만 업로드할 수 있습니다', 400)
  }

  // Supabase Storage에서 파일 다운로드
  const supabase = await createClient()
  const { data: blob, error: downloadError } = await supabase.storage
    .from('reports')
    .download(storagePath)

  if (downloadError || !blob) {
    console.error('Storage 파일 다운로드 오류:', downloadError)
    return errorResponse('파일 다운로드에 실패했습니다', 500)
  }

  // 파일 크기 제한: 10MB
  const MAX_SIZE = 10 * 1024 * 1024
  if (blob.size > MAX_SIZE) {
    await supabase.storage.from('reports').remove([storagePath])
    return errorResponse(
      '파일 크기가 10MB를 초과합니다. 파일을 분할하거나 용량을 줄인 후 다시 업로드해주세요',
      400
    )
  }

  // 파일 형식에 따라 파서 선택
  let rows: ParsedRow[]
  try {
    const buffer = await blob.arrayBuffer()
    rows = isCsv ? parseCsvBuffer(buffer) : parseExcelBuffer(buffer)
  } catch (err) {
    // 컬럼 검증 오류는 별도 응답
    if (err instanceof ColumnValidationError) {
      await supabase.storage.from('reports').remove([storagePath])
      return errorResponse('필수 컬럼이 누락되었습니다', 400, {
        missingColumns: err.detail.missingColumns,
        foundColumns: err.detail.foundColumns,
      })
    }
    await supabase.storage.from('reports').remove([storagePath])
    return errorResponse(
      '파일 파싱에 실패했습니다. 올바른 쿠팡 광고 리포트 파일인지 확인해주세요',
      400
    )
  }

  if (rows.length === 0) {
    return errorResponse('데이터가 없는 파일입니다. 내용을 확인 후 다시 업로드해주세요', 400)
  }

  const { periodStart, periodEnd } = detectPeriod(rows)

  // ── 첫 번째 요청: 중복 감지 단계 ──
  // adGroup 값이 null→실제값으로 변경되어도 기간 기준으로 정확히 감지
  if (overwrite === null) {
    const existingCount = await prisma.adRecord.count({
      where: {
        workspaceId: workspace.id,
        date: { gte: periodStart, lte: periodEnd },
      },
    })

    if (existingCount > 0) {
      return NextResponse.json(
        {
          requiresConfirmation: true,
          duplicateCount: existingCount,
          newCount: rows.length,
          totalCount: rows.length,
        },
        { status: 200 }
      )
    }
    // 중복 없으면 바로 삽입 단계로 진행 (overwrite=false와 동일하게 처리)
  }

  // 2000행 청크 × 5개 병렬 처리
  const CHUNK_SIZE = 2000
  const PARALLEL = 5
  let inserted = 0

  try {
    // 덮어쓰기·중복제외 모두: 기간 내 기존 레코드 삭제 후 재삽입
    // (overwrite=false도 삭제 후 재삽입해야 adGroup 값 불일치로 인한 중복 삽입 방지)
    if (overwrite === 'true' || overwrite === 'false') {
      const campaignIds = [...new Set(rows.map((r) => r.campaignId))]
      await prisma.adRecord.deleteMany({
        where: {
          workspaceId: workspace.id,
          date: { gte: periodStart, lte: periodEnd },
          campaignId: { in: campaignIds },
        },
      })
    }

    // 업로드 이력 생성
    const upload = await prisma.reportUpload.create({
      data: {
        fileName,
        periodStart,
        periodEnd,
        workspaceId: workspace.id,
      },
    })

    // 전체 데이터를 CHUNK_SIZE 단위로 분할
    const allData = rows.map((row) => ({
      workspaceId: workspace.id,
      reportId: upload.id,
      date: row.date,
      adType: row.adType,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      adGroup: row.adGroup,
      placement: row.placement,
      productName: row.productName,
      optionId: row.optionId,
      keyword: row.keyword,
      impressions: row.impressions,
      clicks: row.clicks,
      adCost: row.adCost,
      ctr: row.ctr,
      orders1d: row.orders1d,
      revenue1d: row.revenue1d,
      roas1d: row.roas1d,
      material: row.material,
      videoViews3s: row.videoViews3s,
      avgPlayTime: row.avgPlayTime,
      videoViews25p: row.videoViews25p,
      videoViews50p: row.videoViews50p,
      videoViews75p: row.videoViews75p,
      videoViews100p: row.videoViews100p,
      costPerView3s: row.costPerView3s,
      engagements: row.engagements,
      engagementRate: row.engagementRate,
    }))

    const chunks: (typeof allData)[] = []
    for (let i = 0; i < allData.length; i += CHUNK_SIZE) {
      chunks.push(allData.slice(i, i + CHUNK_SIZE))
    }

    // PARALLEL개씩 병렬 실행 (DB 커넥션 과부하 방지)
    for (let i = 0; i < chunks.length; i += PARALLEL) {
      const group = chunks.slice(i, i + PARALLEL)
      const results = await Promise.all(
        group.map((data) => prisma.adRecord.createMany({ data, skipDuplicates: true }))
      )
      inserted += results.reduce((sum, r) => sum + r.count, 0)
    }

    // ── 캠페인명 변경 감지 ──
    // 업로드 데이터에서 campaignId별 가장 최신 날짜의 campaignName 추출
    const latestByUpload = new Map<string, { date: Date; name: string }>()
    for (const row of rows) {
      const existing = latestByUpload.get(row.campaignId)
      if (!existing || row.date > existing.date) {
        latestByUpload.set(row.campaignId, { date: row.date, name: row.campaignName })
      }
    }

    // DB에서 campaignId별 현재 최신 campaignName 조회 (업로드 전 상태)
    const campaignIds = [...latestByUpload.keys()]
    const dbLatest = await prisma.adRecord.findMany({
      where: {
        workspaceId: workspace.id,
        campaignId: { in: campaignIds },
        // 방금 삽입된 upload 레코드 제외 (이전 업로드 기준)
        reportId: { not: upload.id },
      },
      orderBy: { date: 'desc' },
      distinct: ['campaignId'],
      select: { campaignId: true, campaignName: true },
    })

    const dbNameMap = new Map(dbLatest.map((r) => [r.campaignId, r.campaignName]))

    // 변경된 캠페인 처리 (병렬)
    await Promise.all(
      [...latestByUpload.entries()].map(
        async ([campaignId, { date: firstChangeDate, name: newName }]) => {
          const oldName = dbNameMap.get(campaignId)
          if (!oldName || oldName === newName) {
            // 신규 캠페인이거나 이름 변경 없음 → CampaignMeta만 upsert (신규 시)
            if (!oldName) {
              await prisma.campaignMeta.upsert({
                where: { workspaceId_campaignId: { workspaceId: workspace.id, campaignId } },
                create: {
                  workspaceId: workspace.id,
                  campaignId,
                  displayName: newName,
                  isCustomName: false,
                },
                update: {},
              })
            }
            return
          }

          // 캠페인명 변경 감지: CampaignMeta 업데이트 (isCustomName=false인 경우만)
          const meta = await prisma.campaignMeta.findUnique({
            where: { workspaceId_campaignId: { workspaceId: workspace.id, campaignId } },
            select: { isCustomName: true },
          })

          await prisma.campaignMeta.upsert({
            where: { workspaceId_campaignId: { workspaceId: workspace.id, campaignId } },
            create: {
              workspaceId: workspace.id,
              campaignId,
              displayName: newName,
              isCustomName: false,
            },
            update: meta?.isCustomName ? {} : { displayName: newName },
          })

          // 변경 첫 날짜에 자동 메모 생성
          await prisma.dailyMemo.upsert({
            where: {
              workspaceId_campaignId_date: {
                workspaceId: workspace.id,
                campaignId,
                date: firstChangeDate,
              },
            },
            create: {
              workspaceId: workspace.id,
              campaignId,
              date: firstChangeDate,
              content: `캠페인 이름 변경: ${oldName} → ${newName}`,
            },
            update: {
              content: `캠페인 이름 변경: ${oldName} → ${newName}`,
            },
          })
        }
      )
    )

    // 처리 결과 통계 계산
    const totalRows = rows.length
    const insertedRows = inserted
    const duplicateRows = overwrite === 'true' ? 0 : totalRows - insertedRows
    const skippedRows = 0

    // 업로드 이력에 처리 결과 저장
    await prisma.reportUpload.update({
      where: { id: upload.id },
      data: { totalRows, insertedRows, duplicateRows, skippedRows },
    })

    // 처리 완료 후 Storage 임시 파일 삭제
    await supabase.storage.from('reports').remove([storagePath])

    // 사용량 미터링 — 실패해도 응답에 영향 없음
    const spaceMember = await prisma.spaceMember.findFirst({
      where: { userId: user.id },
      select: { spaceId: true },
    })
    if (spaceMember) {
      trackMeterEvent(spaceMember.spaceId, 'coupang-ads', 'upload_processed').catch(() => {})
    }

    return NextResponse.json(
      {
        uploadId: upload.id,
        inserted,
        skipped: rows.length - inserted,
        totalRows,
        insertedRows,
        duplicateRows,
        errors: [],
      },
      { status: 201 }
    )
  } catch (err) {
    const detail =
      err instanceof Error
        ? {
            message: err.message,
            code: (err as unknown as Record<string, unknown>).code,
            meta: (err as unknown as Record<string, unknown>).meta,
          }
        : String(err)
    console.error('업로드 처리 중 오류:', JSON.stringify(detail, null, 2))
    return errorResponse('데이터 저장 중 오류가 발생했습니다', 500)
  }
}
