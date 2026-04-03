import { prisma } from '@/lib/prisma'
import {
  parseExcelBuffer,
  parseCsvBuffer,
  detectPeriod,
  ColumnValidationError,
} from '@/lib/excel-parser'
import type { ParsedRow } from '@/lib/excel-parser'

// 업로드 처리 결과 타입
export type UploadResult = {
  success: true
  uploadId: string
  inserted: number
  skipped: number
  totalRows: number
  insertedRows: number
  duplicateRows: number
}

// 중복 감지 결과 타입
export type DuplicateDetected = {
  success: false
  requiresConfirmation: true
  duplicateCount: number
  newCount: number
  totalCount: number
}

// 파싱 에러 타입
export type ParseError = {
  success: false
  error: string
  status: number
  extra?: Record<string, unknown>
}

export type ProcessUploadResult = UploadResult | DuplicateDetected | ParseError

// 파일 버퍼를 파싱하고 DB에 저장하는 공유 함수
export async function processUpload(params: {
  workspaceId: string
  fileName: string
  buffer: ArrayBuffer
  overwrite?: boolean | null
}): Promise<ProcessUploadResult> {
  const { workspaceId, fileName, buffer, overwrite } = params

  // 허용 확장자: .xlsx, .csv
  const isXlsx = fileName.endsWith('.xlsx')
  const isCsv = fileName.endsWith('.csv')
  if (!isXlsx && !isCsv) {
    return {
      success: false,
      error: '.xlsx 또는 .csv 파일만 업로드할 수 있습니다',
      status: 400,
    }
  }

  // 파일 형식에 따라 파서 선택
  let rows: ParsedRow[]
  try {
    rows = isCsv ? parseCsvBuffer(buffer) : parseExcelBuffer(buffer)
  } catch (err) {
    if (err instanceof ColumnValidationError) {
      return {
        success: false,
        error: '필수 컬럼이 누락되었습니다',
        status: 400,
        extra: {
          missingColumns: err.detail.missingColumns,
          foundColumns: err.detail.foundColumns,
        },
      }
    }
    return {
      success: false,
      error: '파일 파싱에 실패했습니다. 올바른 쿠팡 광고 리포트 파일인지 확인해주세요',
      status: 400,
    }
  }

  if (rows.length === 0) {
    return {
      success: false,
      error: '데이터가 없는 파일입니다. 내용을 확인 후 다시 업로드해주세요',
      status: 400,
    }
  }

  const { periodStart, periodEnd } = detectPeriod(rows)

  // ── 첫 번째 요청: 중복 감지 단계 ──
  if (overwrite === null) {
    const existingCount = await prisma.adRecord.count({
      where: {
        workspaceId,
        date: { gte: periodStart, lte: periodEnd },
      },
    })

    if (existingCount > 0) {
      return {
        success: false,
        requiresConfirmation: true,
        duplicateCount: existingCount,
        newCount: rows.length,
        totalCount: rows.length,
      }
    }
    // 중복 없으면 바로 삽입 단계로 진행 (overwrite=false와 동일하게 처리)
  }

  // DB 연결 폭주 방지를 위해 청크를 순차 처리한다.
  const CHUNK_SIZE = 2000
  let inserted = 0

  // 덮어쓰기·중복제외 모두: 기간 내 기존 레코드 삭제 후 재삽입
  if (overwrite === true || overwrite === false) {
    const campaignIds = [...new Set(rows.map((r) => r.campaignId))]
    await prisma.adRecord.deleteMany({
      where: {
        workspaceId,
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
      workspaceId,
    },
  })

  // 전체 데이터를 CHUNK_SIZE 단위로 분할
  const allData = rows.map((row) => ({
    workspaceId,
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

  for (const data of chunks) {
    const result = await prisma.adRecord.createMany({ data, skipDuplicates: true })
    inserted += result.count
  }

  // ── 캠페인명 변경 감지 ──
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
      workspaceId,
      campaignId: { in: campaignIds },
      reportId: { not: upload.id },
    },
    orderBy: { date: 'desc' },
    distinct: ['campaignId'],
    select: { campaignId: true, campaignName: true },
  })

  const dbNameMap = new Map(dbLatest.map((r) => [r.campaignId, r.campaignName]))

  for (const [campaignId, { date: firstChangeDate, name: newName }] of latestByUpload.entries()) {
    const oldName = dbNameMap.get(campaignId)
    if (!oldName || oldName === newName) {
      if (!oldName) {
        await prisma.campaignMeta.upsert({
          where: { workspaceId_campaignId: { workspaceId, campaignId } },
          create: { workspaceId, campaignId, displayName: newName, isCustomName: false },
          update: {},
        })
      }
      continue
    }

    // 캠페인명 변경 감지: CampaignMeta 업데이트 (isCustomName=false인 경우만)
    const meta = await prisma.campaignMeta.findUnique({
      where: { workspaceId_campaignId: { workspaceId, campaignId } },
      select: { isCustomName: true },
    })

    await prisma.campaignMeta.upsert({
      where: { workspaceId_campaignId: { workspaceId, campaignId } },
      create: { workspaceId, campaignId, displayName: newName, isCustomName: false },
      update: meta?.isCustomName ? {} : { displayName: newName },
    })

    // 변경 첫 날짜에 자동 메모 생성
    await prisma.dailyMemo.upsert({
      where: {
        workspaceId_campaignId_date: { workspaceId, campaignId, date: firstChangeDate },
      },
      create: {
        workspaceId,
        campaignId,
        date: firstChangeDate,
        content: `캠페인 이름 변경: ${oldName} → ${newName}`,
      },
      update: {
        content: `캠페인 이름 변경: ${oldName} → ${newName}`,
      },
    })
  }

  // 처리 결과 통계 계산
  const totalRows = rows.length
  const insertedRows = inserted
  const duplicateRows = overwrite === true ? 0 : totalRows - insertedRows
  const skippedRows = 0

  // 업로드 이력에 처리 결과 저장
  await prisma.reportUpload.update({
    where: { id: upload.id },
    data: { totalRows, insertedRows, duplicateRows, skippedRows },
  })

  return {
    success: true,
    uploadId: upload.id,
    inserted,
    skipped: rows.length - inserted,
    totalRows,
    insertedRows,
    duplicateRows,
  }
}
