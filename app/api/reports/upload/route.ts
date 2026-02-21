import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { parseExcelBuffer, detectPeriod } from '@/lib/excel-parser'

// POST /api/reports/upload — multipart/form-data 엑셀 업로드
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // multipart/form-data 파싱
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('multipart/form-data 파싱에 실패했습니다', 400)
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return errorResponse('파일을 첨부해주세요', 400)
  }

  if (!file.name.endsWith('.xlsx')) {
    return errorResponse('.xlsx 파일만 업로드할 수 있습니다', 400)
  }

  // Excel 파싱
  let rows
  try {
    const buffer = await file.arrayBuffer()
    rows = parseExcelBuffer(buffer)
  } catch {
    return errorResponse('Excel 파일 파싱에 실패했습니다', 400)
  }

  if (rows.length === 0) {
    return errorResponse('파싱된 데이터가 없습니다. 쿠팡 광고 리포트 형식의 파일인지 확인해주세요', 400)
  }

  const { periodStart, periodEnd } = detectPeriod(rows)

  // 업로드 이력 생성
  const upload = await prisma.reportUpload.create({
    data: {
      fileName: file.name,
      periodStart,
      periodEnd,
      workspaceId: workspace.id,
    },
  })

  // 500행 청크로 분할하여 upsert
  const chunkSize = 500
  let inserted = 0
  let updated = 0

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)

    await prisma.$transaction(
      chunk.map((row) =>
        prisma.adRecord.upsert({
          where: {
            workspaceId_date_campaignId_adType_keyword_adGroup_optionId: {
              workspaceId: workspace.id,
              date: row.date,
              campaignId: row.campaignId,
              adType: row.adType,
              // Prisma 7 compound unique 타입이 string을 요구하나 런타임에서 null 정상 처리
              keyword: row.keyword as string,
              adGroup: row.adGroup as string,
              optionId: row.optionId as string,
            },
          },
          create: {
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
            orders14d: row.orders14d,
            revenue14d: row.revenue14d,
            roas14d: row.roas14d,
          },
          update: {
            campaignName: row.campaignName,
            placement: row.placement,
            productName: row.productName,
            impressions: row.impressions,
            clicks: row.clicks,
            adCost: row.adCost,
            ctr: row.ctr,
            orders1d: row.orders1d,
            revenue1d: row.revenue1d,
            roas1d: row.roas1d,
            orders14d: row.orders14d,
            revenue14d: row.revenue14d,
            roas14d: row.roas14d,
          },
        })
      )
    )

    // upsert는 inserted/updated 구분이 어려워 전체를 inserted로 계산
    inserted += chunk.length
  }

  return NextResponse.json(
    {
      uploadId: upload.id,
      inserted,
      updated,
      skipped: 0,
      errors: [],
    },
    { status: 201 }
  )
}
