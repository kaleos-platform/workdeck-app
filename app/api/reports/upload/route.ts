import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { createClient } from '@/lib/supabase/server'
import {
  parseExcelBuffer,
  parseCsvBuffer,
  detectPeriod,
  ColumnValidationError,
} from '@/lib/excel-parser'
import type { ParsedRow } from '@/lib/excel-parser'

// 중복 감지용 복합 키 생성
function buildKey(row: {
  date: Date | string
  campaignId: string
  adType: string
  keyword: string | null
  adGroup: string | null
  optionId: string | null
}): string {
  const d = row.date instanceof Date ? row.date.toISOString() : row.date
  return `${d}|${row.campaignId}|${row.adType}|${row.keyword ?? ''}|${row.adGroup ?? ''}|${row.optionId ?? ''}`
}

// POST /api/reports/upload — JSON body { storagePath, fileName }
// 브라우저가 Supabase Storage에 직접 업로드한 파일을 서버에서 다운로드 후 파싱·저장
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // overwrite 쿼리 파라미터: null(첫 요청), 'true'(덮어쓰기), 'false'(중복 스킵)
  const url = new URL(request.url)
  const overwrite = url.searchParams.get('overwrite')

  // JSON body 파싱
  let storagePath: string
  let fileName: string
  try {
    const body = await request.json()
    storagePath = body.storagePath
    fileName = body.fileName
    if (!storagePath || !fileName) throw new Error('필드 누락')
  } catch {
    return errorResponse('storagePath와 fileName이 필요합니다', 400)
  }

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
    return errorResponse(
      '파싱된 데이터가 없습니다. 쿠팡 광고 리포트 형식의 파일인지 확인해주세요',
      400
    )
  }

  const { periodStart, periodEnd } = detectPeriod(rows)

  // ── 첫 번째 요청: 중복 감지 단계 ──
  if (overwrite === null) {
    const existing = await prisma.adRecord.findMany({
      where: {
        workspaceId: workspace.id,
        date: { gte: periodStart, lte: periodEnd },
      },
      select: {
        date: true,
        campaignId: true,
        adType: true,
        keyword: true,
        adGroup: true,
        optionId: true,
      },
    })

    if (existing.length > 0) {
      const existingSet = new Set(existing.map(buildKey))
      const duplicateCount = rows.filter((r) => existingSet.has(buildKey(r))).length

      if (duplicateCount > 0) {
        return NextResponse.json(
          {
            requiresConfirmation: true,
            duplicateCount,
            newCount: rows.length - duplicateCount,
            totalCount: rows.length,
          },
          { status: 200 }
        )
      }
    }
    // 중복 없으면 바로 삽입 단계로 진행 (overwrite=false와 동일하게 처리)
  }

  // 2000행 청크 × 5개 병렬 처리
  const CHUNK_SIZE = 2000
  const PARALLEL = 5
  let inserted = 0

  try {
    // 덮어쓰기 모드: 해당 기간 + campaignIds에 해당하는 기존 레코드 삭제
    if (overwrite === 'true') {
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

    // 처리 완료 후 Storage 임시 파일 삭제
    await supabase.storage.from('reports').remove([storagePath])

    return NextResponse.json(
      {
        uploadId: upload.id,
        inserted,
        skipped: rows.length - inserted,
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
